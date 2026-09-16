#!/usr/bin/env python3
"""
Auditoria de RLS do Supabase da Zenith Ride — v2 (leitura exacta).

PORQUE ISTO EXISTE
------------------
A `anon key` do Supabase e' PUBLICA por desenho: vai dentro do bundle que o
browser descarrega. Nao e' um segredo. A unica coisa que protege os dados sao
as politicas de RLS.

Este script assume o papel de um atacante que so' tem o bundle (logo, a anon
key) e pergunta, tabela a tabela, QUANTAS LINHAS consegue ver.

=== PORQUE E' QUE A v1 ESTAVA ERRADA (nao repetir) ===
A v1 testava DELETE/UPDATE com um filtro impossivel e tratava `204` como fuga.
ERRADO. Quando o RLS filtra as linhas, o PostgREST devolve `204` na mesma:
"sucesso, 0 linhas afectadas". E' indistinguivel de "RLS permite tudo".
Resultado: 60+ falsos positivos.

O que se aprende de DELETE/UPDATE por HTTP:
    401 / 403  -> o role nao tem GRANT. Bloqueado de facto.
    204        -> inconclusivo. Pode ser RLS a filtrar, ou acesso total.
Nao ha teste nao-destrutivo que separe os dois. Por isso a v2 nao os reporta
como fuga — reporta-os como "inconclusivo", e cruza com a lista de tabelas que
sabemos nao terem RLS (essas sim, um 204 e' acesso total).

=== O TESTE QUE DECIDE ===
GET /rest/v1/<tabela>?select=* com `Prefer: count=exact`.
A resposta traz `Content-Range: 0-0/N` -> N = linhas visiveis para a anon key.
N > 0 numa tabela que devia ser privada = fuga confirmada, sem margem.

NAO E' DESTRUTIVO. So' faz GET.

USO
---
    python scripts/audit-supabase-rls.py [--verbose]
"""

import io
import json
import os
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(RAIZ, ".env")

# Tabelas que JÁ TIVERAM RLS desactivado, corrigidas pela migration
# `20260915180000_security_hardening.sql` (2026-09-15). A lista fica aqui só
# como registo histórico.
#
# ⚠️ NÃO acrescentar nomes a esta lista a partir de leitura de ficheiros .sql.
# Já me enganou uma vez: a lista era um retrato do SQL das migrations, e depois
# de a correcção ser aplicada à base de dados o script continuou a gritar
# "ACESSO TOTAL" sobre tabelas que já estavam protegidas. Um falso positivo
# destes faz perder tempo a investigar o que não existe.
#
# A verdade sobre RLS lê-se da BASE DE DADOS, não do código:
#     npx supabase db advisors --linked --type security
#     npx supabase db query --linked \
#       "select tablename, rowsecurity from pg_tables where schemaname='public'"
SEM_RLS_CONHECIDAS_E_CORRIGIDAS = {
    "api_rate_limits",
    "cash_advances",
    "demand_heatmap",
    "driver_insurance",
    "ride_prediction_sources",
}
SEM_RLS: set[str] = set()   # vazio de propósito — ver nota acima

# Tabelas cujos dados sao publicos POR DESENHO (a app mostra-os a qualquer
# visitante). Uma leitura aqui nao e' vulnerabilidade.
PUBLICAS_POR_DESENHO = {"pricing_config", "service_pricing", "zenithpay_partners"}

TABELAS = [
    "ai_event_logs", "ai_response_cache", "ai_usage_logs", "api_rate_limits",
    "cargo_bookings", "cash_advances", "charter_bookings", "conversation_memory",
    "demand_heatmap", "driver_credit_history", "driver_credit_log",
    "driver_documents", "driver_insurance", "driver_recharges", "driver_wallets",
    "elevenlabs_usage", "fleet_billing_events", "fleet_cars",
    "fleet_driver_agreements", "fleet_subscriptions", "fleets", "geocoding_cache",
    "kaze_chat_quota_live", "message_dedup", "notifications", "panic_alerts",
    "passenger_scores", "pending_payments", "premium_bookings", "pricing_config",
    "rate_limit_log", "referrals", "ride_messages", "ride_prediction_sources",
    "ride_tracking_shares", "route_deviation_alerts", "safety_watchdog_alerts",
    "scheduled_rides", "service_pricing", "user_profiles", "whatsapp_sessions",
    "zenith_scores", "zenithpay_partners",
]

VERDE, VERMELHO, AMARELO, CINZA, RESET = (
    "\033[0;32m", "\033[0;31m", "\033[0;33m", "\033[0;90m", "\033[0m",
)


def ler_env(caminho):
    valores = {}
    with io.open(caminho, encoding="utf-8", errors="replace") as fh:
        for linha in fh:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                valores[k] = v
    return valores


def pedido(url, anon, metodo="GET", corpo=None, cabecalhos=None):
    """Devolve (status, corpo, cabecalhos). Nunca levanta por erro HTTP."""
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("apikey", anon)
    req.add_header("Authorization", "Bearer " + anon)
    req.add_header("Content-Type", "application/json")
    for k, v in (cabecalhos or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers or {})
    except Exception as e:                                    # noqa: BLE001
        return 0, "%s: %s" % (type(e).__name__, e), {}


def contar(url, anon):
    """Linhas visiveis para a anon key, via Content-Range. None se indeterminado."""
    status, _, cabecalhos = pedido(
        url + "?select=*", anon,
        cabecalhos={"Prefer": "count=exact", "Range": "0-0"},
    )
    if status not in (200, 206):
        return status, None
    cr = cabecalhos.get("Content-Range") or cabecalhos.get("content-range") or ""
    # formato: "0-0/123"  ou  "*/0"
    if "/" not in cr:
        return status, None
    try:
        return status, int(cr.split("/")[-1])
    except ValueError:
        return status, None


def main():
    verboso = "--verbose" in sys.argv

    if not os.path.isfile(ENV):
        print("erro: .env nao encontrado em %s" % ENV)
        return 2

    env = ler_env(ENV)
    base = env.get("VITE_SUPABASE_URL", "").rstrip("/")
    anon = env.get("VITE_SUPABASE_ANON_KEY", "")
    if not base or not anon:
        print("erro: VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY em falta no .env")
        return 2

    print("=" * 76)
    print("AUDITORIA RLS v2 — Zenith Ride (contagem exacta, so' leitura)")
    print("=" * 76)
    print("alvo      : %s" % base)
    print("credencial: anon key (%d chars) — PUBLICA, vai no bundle" % len(anon))
    print()

    fugas, sem_rls_expostas, inconclusivas, bloqueadas, inexistentes = [], [], [], [], []

    print("%-30s %-8s %-7s %s" % ("TABELA", "LER", "LINHAS", "APAGAR/ALTERAR"))
    print("-" * 76)

    for t in TABELAS:
        url = "%s/rest/v1/%s" % (base, t)
        st_ler, n = contar(url, anon)
        st_del, _, _ = pedido("%s?id=eq.00000000-0000-0000-0000-000000000000" % url,
                              anon, "DELETE")
        st_upd, _, _ = pedido("%s?id=eq.00000000-0000-0000-0000-000000000000" % url,
                              anon, "PATCH", {})

        if st_ler == 404:
            inexistentes.append(t)
            print("%-30s %s" % (t, CINZA + "nao existe" + RESET))
            continue

        escrita = []
        for op, st in (("DELETE", st_del), ("UPDATE", st_upd)):
            if st in (401, 403):
                continue                       # bloqueado de facto
            if st in (200, 204):
                escrita.append(op)
        if st_del in (401, 403) and st_upd in (401, 403):
            bloqueadas.append(t)

        # --- leitura ---
        if n is None:
            ler_txt = AMARELO + str(st_ler) + RESET
            linhas_txt = CINZA + "?" + RESET
        elif n > 0:
            if t in PUBLICAS_POR_DESENHO:
                ler_txt = VERDE + str(st_ler) + RESET
                linhas_txt = VERDE + str(n) + RESET
            else:
                ler_txt = VERMELHO + str(st_ler) + RESET
                linhas_txt = VERMELHO + str(n) + RESET
                fugas.append((t, n))
        else:
            ler_txt = VERDE + str(st_ler) + RESET
            linhas_txt = VERDE + "0" + RESET

        # --- escrita ---
        if escrita:
            if t in SEM_RLS:
                esc_txt = VERMELHO + "ACESSO TOTAL (%s)" % "+".join(escrita) + RESET
                sem_rls_expostas.append((t, escrita))
            else:
                esc_txt = AMARELO + "inconclusivo (%s)" % "+".join(escrita) + RESET
                inconclusivas.append(t)
        else:
            esc_txt = VERDE + "bloqueado" + RESET

        print("%-30s %-17s %-16s %s" % (t, ler_txt, linhas_txt, esc_txt))

    print()
    print("=" * 76)
    print("RESUMO")
    print("=" * 76)

    if fugas:
        print(VERMELHO + "FUGA DE LEITURA CONFIRMADA (linhas reais visiveis a qualquer visitante):" + RESET)
        for t, n in fugas:
            print("   %-28s %d linha(s)" % (t, n))
    else:
        print(VERDE + "Nenhuma fuga de leitura confirmada." + RESET)
    print()

    if sem_rls_expostas:
        print(VERMELHO + "SEM RLS + ESCRITA ABERTA (nao ha politica nenhuma a proteger):" + RESET)
        for t, ops in sem_rls_expostas:
            print("   %-28s %s" % (t, "+".join(ops)))
    print()

    if inconclusivas:
        print(AMARELO + "ESCRITA INCONCLUSIVA — tem RLS, o 204 e' esperado. NAO e' fuga." + RESET)
        print(CINZA + "   Confirma-se lendo as politicas de cada uma no SQL, nao por HTTP." + RESET)
        if verboso:
            for t in inconclusivas:
                print("   - %s" % t)
        else:
            print(CINZA + "   %d tabelas (usar --verbose para listar)" % len(inconclusivas))
    print()

    if inexistentes:
        print(CINZA + "Nao existem (nome desactualizado na lista): %s" % ", ".join(inexistentes) + RESET)
    if bloqueadas:
        print(VERDE + "Bloqueadas de facto (401/403): %s" % ", ".join(bloqueadas) + RESET)

    print()
    print(CINZA + "Tabelas publicas por desenho (leitura esperada, nao e' falha): "
          + ", ".join(sorted(PUBLICAS_POR_DESENHO)) + RESET)
    print(CINZA + "Corrigidas em 2026-09-15 (RLS activado, ja nao aparecem como falha): "
          + ", ".join(sorted(SEM_RLS_CONHECIDAS_E_CORRIGIDAS)) + RESET)
    print(CINZA + "Para a verdade sobre RLS: npx supabase db advisors --linked --type security" + RESET)

    return 1 if (fugas or sem_rls_expostas) else 0


if __name__ == "__main__":
    sys.exit(main())
