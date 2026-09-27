#!/usr/bin/env python
# =============================================================================
# ZENITH RIDE — BACKUP COMPLETO DA BASE DE DADOS (dump lógico, sem Docker)
#
# PORQUÊ ISTO EXISTE
#   O plano Free da Supabase **não tem backups automáticos** (só Pro/Team/
#   Enterprise). A própria documentação deles diz:
#     "We recommend that free tier plan projects regularly export their data
#      using the Supabase CLI db dump command and maintain off-site backups."
#   E o `supabase db dump` **exige Docker**, que não está instalado aqui.
#
# COMO FUNCIONA
#   1. Pede ao CLI uma credencial temporária (`db dump --dry-run` só imprime).
#   2. Liga-se com `pg8000` (driver puro Python, sem compilação).
#   3. Faz `set role postgres` — a credencial do CLI é MEMBRO de `postgres`,
#      mas não herda privilégios sozinha. Sem isto dá `42501`.
#   4. Extrai o DDL a partir do catálogo do PostgreSQL (é a fonte da verdade)
#      e os dados como INSERTs.
#
# ARMADILHA DO pg8000
#   A assinatura é `run(sql, stream=None, types=None, **params)`.
#   NÃO aceita parâmetros posicionais (`%s`): usar `:nome` + argumentos
#   nomeados. Passar um valor posicional dá
#     ValueError: dictionary update sequence element #0 has length 1; 2 is required
#
# O QUE SAI
#   backups/<data-hora>/   ficheiros numerados, pela ordem de restauro
#
# O QUE **NÃO** É COPIADO (limitação do dump lógico, não do script)
#   - Objectos do Storage (ficheiros: fotos, documentos) — só metadados.
#   - Edge Functions.
#   - Segredos do Vault: saem CIFRADOS e ficam ilegíveis noutro projecto
#     (a chave-raiz de cifra é por projecto). Ver LEIA-ME.txt.
#   - Definições de Auth, chaves de API, JWT secret, Realtime.
# =============================================================================

import subprocess, re, sys, os, json, datetime, decimal
from pathlib import Path

try:
    import pg8000.native
except ImportError:
    sys.exit("Falta o pg8000. Instalar com:\n"
             '  "<venv>/Scripts/python.exe" -m pip install pg8000')

RAIZ = Path(__file__).resolve().parent.parent

# Listas de schemas como literais SQL (são constantes, não input do utilizador).
LISTA_DDL    = "('public','auth','storage')"
LISTA_DADOS  = "('public','auth')"
LISTA_GRANTS = "('public','auth','storage')"


# ------------------------------------------------------------------ ligação
def credenciais_do_cli() -> dict:
    """O CLI cria uma role de login temporária; o --dry-run imprime-a."""
    print("  a pedir credencial temporária ao CLI (pode levar ~20 s)...")
    r = subprocess.run("npx --yes supabase db dump --linked --schema public --dry-run",
                       capture_output=True, text=True, shell=True, timeout=300)
    saida = r.stdout + r.stderr

    def pegar(nome):
        m = re.search(r'export ' + nome + r'="([^"]+)"', saida)
        return m.group(1) if m else None

    c = {"host": pegar("PGHOST"), "port": int(pegar("PGPORT") or 5432),
         "user": pegar("PGUSER"), "password": pegar("PGPASSWORD"),
         "database": pegar("PGDATABASE") or "postgres"}
    if not all([c["host"], c["user"], c["password"]]):
        sys.exit("Não consegui obter credenciais do CLI.\n--- saída ---\n" + saida[:1500])
    return c


# ------------------------------------------------------- formatação de SQL
def cita(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def literal(v) -> str:
    """Converte um valor Python em literal SQL seguro."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "'\\x" + bytes(v).hex() + "'::bytea"
    if isinstance(v, datetime.datetime):
        return "'" + v.isoformat() + "'::timestamptz"
    if isinstance(v, datetime.date):
        return "'" + v.isoformat() + "'::date"
    if isinstance(v, datetime.time):
        return "'" + v.isoformat() + "'::time"
    if isinstance(v, (dict, list)):
        return cita(json.dumps(v, ensure_ascii=False))
    return cita(str(v))


def ident(*partes) -> str:
    return ".".join('"' + str(p).replace('"', '""') + '"' for p in partes)


# ------------------------------------------------------------------- dump
class Dump:
    def __init__(self, con):
        self.con = con
        self.avisos = []

    def q(self, sql, **params):
        return self.con.run(sql, **params)

    def ficheiro(self, pasta, numero, nome, titulo, sql):
        caminho = pasta / f"{numero}_{nome}.sql"
        with open(caminho, "w", encoding="utf-8") as f:
            f.write("-- =====================================================\n")
            f.write(f"-- {titulo}\n")
            f.write(f"-- gerado em {datetime.datetime.now().isoformat(timespec='seconds')}\n")
            f.write("-- =====================================================\n\n")
            f.write(sql if sql.endswith("\n") else sql + "\n")
        print(f"    {caminho.name:<32} {caminho.stat().st_size:>9,} bytes")
        return caminho

    # -- 01 extensões
    def extensoes(self):
        linhas = ["-- Recriar as extensões ANTES de tudo o resto.",
                  "-- Num projecto novo algumas já vêm instaladas; o IF NOT EXISTS trata disso.",
                  ""]
        for nome, schema in self.q("""
                select e.extname, n.nspname from pg_extension e
                join pg_namespace n on n.oid = e.extnamespace
                where e.extname <> 'plpgsql' order by 1"""):
            linhas.append(f"create extension if not exists {ident(nome)} with schema {ident(schema)};")
        linhas += ["", "-- Versões de origem (referência, não executar):"]
        for nome, schema, versao in self.q("""
                select e.extname, n.nspname, e.extversion from pg_extension e
                join pg_namespace n on n.oid = e.extnamespace order by 1"""):
            linhas.append(f"--   {nome} {versao}  (schema {schema})")
        return "\n".join(linhas) + "\n"

    # -- 02 tipos (enums)
    def tipos(self):
        linhas = ["-- Tipos ENUM definidos pela aplicação.", ""]
        enums = self.q("""
            select n.nspname, t.typname from pg_type t
            join pg_namespace n on n.oid = t.typnamespace
            where t.typtype = 'e' and n.nspname not in ('pg_catalog','information_schema')
            order by 1, 2""")
        if not enums:
            linhas.append("-- (não há enums definidos pela aplicação)")
        for nsp, typ in enums:
            etiquetas = [r[0] for r in self.q("""
                select enumlabel from pg_enum
                where enumtypid = (select t.oid from pg_type t
                    join pg_namespace n on n.oid = t.typnamespace
                    where t.typname = :typ and n.nspname = :nsp)
                order by enumsortorder""", typ=typ, nsp=nsp)]
            vals = ", ".join(cita(e) for e in etiquetas)
            linhas.append(f"do $$ begin create type {ident(nsp, typ)} as enum ({vals});\n"
                          f"exception when duplicate_object then null; end $$;")
        return "\n".join(linhas) + "\n"

    # -- 03 tabelas
    def tabelas(self):
        # ⚠️ DUAS PASSAGENS — isto é essencial, não é estilo.
        #
        # Na primeira versão eu criava cada tabela e adicionava logo as SUAS
        # restrições, por ordem alfabética. Resultado: 61 das 102 chaves
        # estrangeiras apontavam para tabelas que ainda não existiam
        # (`ai_usage_logs` -> `users`, que nasce 70 tabelas depois) e a
        # restauração rebentava a meio.
        #
        # O dump parecia perfeito — 108 tabelas, 1050 colunas, todos os dados —
        # e mesmo assim não restaurava. Por isso: primeiro TODAS as tabelas,
        # só depois TODAS as restrições.
        linhas = ["-- CREATE TABLE + colunas e defaults.",
                  "-- ⚠️ As restrições vêm TODAS no fim do ficheiro, de propósito:",
                  "--    uma chave estrangeira só pode ser criada depois de a tabela",
                  "--    alvo existir. Ver a secção RESTRIÇÕES mais abaixo.",
                  ""]

        tabelas = self.q(f"""
                select n.nspname, c.relname from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r','p') and not c.relispartition
                  and n.nspname in {LISTA_DDL} order by 1, 2""")

        # ---------- PASSAGEM 1: criar todas as tabelas ----------
        for nsp, tab in tabelas:
            colunas = self.q("""
                select a.attname, format_type(a.atttypid, a.atttypmod),
                       pg_get_expr(d.adbin, d.adrelid), a.attnotnull, a.attidentity
                from pg_attribute a
                left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                where a.attrelid = (select c.oid from pg_class c
                        join pg_namespace n on n.oid = c.relnamespace
                        where c.relname = :tab and n.nspname = :nsp)
                  and a.attnum > 0 and not a.attisdropped order by a.attnum""",
                tab=tab, nsp=nsp)
            defs = []
            for nome, tipo, default, notnull, identidade in colunas:
                d = f"  {ident(nome)} {tipo}"
                if identidade == "a":
                    d += " generated always as identity"
                elif identidade == "d":
                    d += " generated by default as identity"
                elif default is not None:
                    d += f" default {default}"
                if notnull:
                    d += " not null"
                defs.append(d)
            linhas.append(f"create table if not exists {ident(nsp, tab)} (\n"
                          + ",\n".join(defs) + "\n);")
        linhas.append("")

        # ---------- PASSAGEM 2: todas as restrições ----------
        linhas += ["-- =====================================================",
                   "-- RESTRIÇÕES — todas depois de todas as tabelas existirem.",
                   "-- =====================================================",
                   ""]
        for nsp, tab in tabelas:
            restricoes = self.q("""
                    select conname, pg_get_constraintdef(oid) from pg_constraint
                    where conrelid = (select c.oid from pg_class c
                          join pg_namespace n on n.oid = c.relnamespace
                          where c.relname = :tab and n.nspname = :nsp)
                    order by (contype = 'p') desc, conname""", tab=tab, nsp=nsp)
            for con, definicao in restricoes:
                linhas.append(f"alter table only {ident(nsp, tab)} "
                              f"add constraint {ident(con)} {definicao};")
        linhas.append("")

        vistas = self.q(f"""
            select n.nspname, c.relname, pg_get_viewdef(c.oid, true) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'v' and n.nspname in {LISTA_DDL} order by 1, 2""")
        if vistas:
            linhas.append("-- VISTAS")
            for nsp, nome, definicao in vistas:
                linhas.append(f"create or replace view {ident(nsp, nome)} as\n{definicao.strip()};")
            linhas.append("")
        return "\n".join(linhas) + "\n"

    # -- 04 sequências
    def sequencias(self):
        linhas = ["-- Sequências e o valor actual (para os IDs continuarem certos).", ""]
        n = 0
        for nsp, nome, ultimo in self.q(f"""
                select schemaname, sequencename, last_value from pg_sequences
                where schemaname in {LISTA_DDL} order by 1, 2"""):
            if ultimo is None:
                continue
            linhas.append(f"select setval('{nsp}.{nome}', {ultimo}, true);")
            n += 1
        if n == 0:
            linhas.append("-- (nenhuma sequência com valor definido)")
        return "\n".join(linhas) + "\n"

    # -- 05 dados
    def dados(self, pasta):
        caminho = pasta / "05_dados.sql"
        total = 0
        with open(caminho, "w", encoding="utf-8") as f:
            f.write("-- =====================================================\n")
            f.write("-- DADOS — INSERTs por tabela\n")
            f.write(f"-- gerado em {datetime.datetime.now().isoformat(timespec='seconds')}\n")
            f.write("-- =====================================================\n\n")
            f.write("-- Desactivar triggers durante a carga (reposto no fim do ficheiro).\n")
            f.write("-- Sem isto, triggers de negócio (ex.: débitos de carteira) disparariam\n")
            f.write("-- durante a restauração e corromperiam os saldos.\n")
            f.write("set session_replication_role = replica;\n\n")

            tabelas = self.q(f"""
                select n.nspname, c.relname from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relkind = 'r' and not c.relispartition
                  and n.nspname in {LISTA_DADOS} order by 1, 2""")
            for nsp, tab in tabelas:
                try:
                    n = self.q(f"select count(*) from {ident(nsp, tab)}")[0][0]
                except Exception as e:
                    f.write(f"-- {nsp}.{tab}: ILEGÍVEL ({str(e)[:80]})\n")
                    self.avisos.append(f"{nsp}.{tab}: ilegível")
                    continue
                if n == 0:
                    continue
                f.write(f"\n-- ---- {nsp}.{tab} ({n} linhas) ----\n")
                try:
                    self._inserir(f, nsp, tab, n)
                    total += n
                except Exception as e:
                    f.write(f"-- ERRO ao extrair {nsp}.{tab}: {str(e)[:200]}\n")
                    self.avisos.append(f"{nsp}.{tab}: erro de extração")

            f.write("\nset session_replication_role = default;\n")
        print(f"    {caminho.name:<32} {caminho.stat().st_size:>9,} bytes   ({total:,} linhas)")
        return caminho

    def _inserir(self, f, nsp, tab, n, lote=250):
        cols = [r[0] for r in self.q("""
            select a.attname from pg_attribute a
            where a.attrelid = (select c.oid from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                  where c.relname = :tab and n.nspname = :nsp)
              and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
            order by a.attnum""", tab=tab, nsp=nsp)]
        if not cols:
            return
        lista = ", ".join(ident(c) for c in cols)
        alvo = f"insert into {ident(nsp, tab)} ({lista}) values\n"
        offset = 0
        while offset < n:
            linhas = self.q(f"select {lista} from {ident(nsp, tab)} "
                            f"limit {lote} offset {offset}")
            if not linhas:
                break
            valores = ",\n".join("  (" + ", ".join(literal(v) for v in linha) + ")"
                                 for linha in linhas)
            f.write(alvo + valores + "\non conflict do nothing;\n")
            offset += lote

    # -- 06 funções
    def funcoes(self):
        linhas = ["-- Funções e procedimentos da aplicação.", ""]
        n = 0
        for definicao in self.q(f"""
                select pg_get_functiondef(p.oid)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in {LISTA_DDL} and p.prokind in ('f','p')
                order by n.nspname, p.proname"""):
            linhas.append(definicao[0].strip() + ";")
            linhas.append("")
            n += 1
        linhas.append(f"-- total: {n} funções")
        return "\n".join(linhas) + "\n"

    # -- 07 triggers
    def triggers(self):
        linhas = ["-- Triggers (as funções já foram criadas no ficheiro anterior).", ""]
        n = 0
        for definicao in self.q(f"""
                select pg_get_triggerdef(t.oid, true) from pg_trigger t
                join pg_class c on c.oid = t.tgrelid
                join pg_namespace n on n.oid = c.relnamespace
                where not t.tgisinternal and n.nspname in {LISTA_DDL}
                order by n.nspname, c.relname, t.tgname"""):
            linhas.append(definicao[0].strip() + ";")
            n += 1
        linhas.append(f"\n-- total: {n} triggers")
        return "\n".join(linhas) + "\n"

    # -- 08 RLS
    def rls(self):
        linhas = ["-- Row Level Security: ligar a protecção e recriar as políticas.", ""]
        for nsp, tab in self.q(f"""
                select n.nspname, c.relname from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relkind = 'r' and c.relrowsecurity and n.nspname in {LISTA_DDL}
                order by 1, 2"""):
            linhas.append(f"alter table {ident(nsp, tab)} enable row level security;")
            forcado = self.q("""
                select c.relforcerowsecurity from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relname = :tab and n.nspname = :nsp""", tab=tab, nsp=nsp)
            if forcado and forcado[0][0]:
                linhas.append(f"alter table {ident(nsp, tab)} force row level security;")
        linhas += ["", "-- POLÍTICAS"]
        n = 0
        for nsp, tab, nome, cmd, permissiva, papeis, usando, check in self.q(f"""
                select schemaname, tablename, policyname, cmd, permissive,
                       array_to_string(roles, ','), qual, with_check
                from pg_policies where schemaname in {LISTA_GRANTS} order by 1, 2, 3"""):
            tipo = " as restrictive" if permissiva == "RESTRICTIVE" else ""
            para = ", ".join(p if p == "public" else ident(p)
                             for p in str(papeis).split(","))
            texto = (f"create policy {ident(nome)} on {ident(nsp, tab)}{tipo}"
                     f" for {str(cmd).lower()} to {para}")
            if usando:
                texto += f" using ({usando})"
            if check:
                texto += f" with check ({check})"
            linhas.append(texto + ";")
            n += 1
        linhas.append(f"\n-- total: {n} políticas")
        return "\n".join(linhas) + "\n"

    # -- 09 índices
    def indices(self):
        linhas = ["-- Índices que NÃO pertencem a restrições (esses vieram com as tabelas).", ""]
        n = 0
        for definicao in self.q(f"""
                select pg_get_indexdef(i.indexrelid) from pg_index i
                join pg_class c on c.oid = i.indrelid
                join pg_class ic on ic.oid = i.indexrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname in {LISTA_DDL}
                  and not exists (select 1 from pg_constraint con
                                  where con.conindid = i.indexrelid)
                  and i.indisvalid
                order by n.nspname, ic.relname"""):
            linhas.append(definicao[0].strip() + ";")
            n += 1
        linhas.append(f"\n-- total: {n} índices")
        return "\n".join(linhas) + "\n"

    # -- 10 grants
    def grants(self):
        linhas = ["-- Permissões. Sem isto o PostgREST não vê as tabelas no projecto novo.",
                  "-- `anon` e `authenticated` são os papéis que a API usa.", ""]
        n = 0
        for nsp, tab, grantee, privilegio in self.q(f"""
                select table_schema, table_name, grantee, privilege_type
                from information_schema.role_table_grants
                where table_schema in {LISTA_GRANTS}
                  and grantee in ('anon','authenticated','service_role','postgres')
                order by 1, 2, 3, 4"""):
            linhas.append(f"grant {privilegio} on table {ident(nsp, tab)} to {ident(grantee)};")
            n += 1
        linhas.append(f"\n-- total: {n} permissões")
        return "\n".join(linhas) + "\n"


# ------------------------------------------------------------------ principal
def main():
    print("=" * 72)
    print("BACKUP COMPLETO — Zenith Ride")
    print("=" * 72)

    cred = credenciais_do_cli()
    print(f"  ligado a {cred['host']} como {cred['user'][:26]}...")

    con = pg8000.native.Connection(user=cred["user"], password=cred["password"],
                                   host=cred["host"], port=cred["port"],
                                   database=cred["database"], timeout=180)
    # A credencial do CLI é membro de `postgres` mas NÃO herda privilégios.
    # Sem esta linha, todas as tabelas dão 42501.
    con.run("set role postgres")

    versao = con.run("select version()")[0][0]
    tamanho = con.run("select pg_size_pretty(pg_database_size(current_database()))")[0][0]
    print("  " + versao.split(",")[0])
    print(f"  tamanho da base: {tamanho}")
    print()

    marca = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    pasta = RAIZ / "backups" / marca
    pasta.mkdir(parents=True, exist_ok=True)

    d = Dump(con)
    print("  a extrair:")
    d.ficheiro(pasta, "01", "extensoes",  "EXTENSÕES", d.extensoes())
    d.ficheiro(pasta, "02", "tipos",      "TIPOS (enums)", d.tipos())
    d.ficheiro(pasta, "03", "tabelas",    "TABELAS, COLUNAS E RESTRIÇÕES", d.tabelas())
    d.ficheiro(pasta, "04", "sequencias", "SEQUÊNCIAS", d.sequencias())
    d.dados(pasta)
    d.ficheiro(pasta, "06", "funcoes",    "FUNÇÕES E PROCEDIMENTOS", d.funcoes())
    d.ficheiro(pasta, "07", "triggers",   "TRIGGERS", d.triggers())
    d.ficheiro(pasta, "08", "rls",        "ROW LEVEL SECURITY E POLÍTICAS", d.rls())
    d.ficheiro(pasta, "09", "indices",    "ÍNDICES", d.indices())
    d.ficheiro(pasta, "10", "grants",     "PERMISSÕES (GRANTS)", d.grants())

    info = {
        "gerado_em": datetime.datetime.now().isoformat(timespec="seconds"),
        "projeto": "mhahnhnsaquqgqvnnwld",
        "regiao": "West EU (Paris)",
        "postgres": versao,
        "tamanho_base": tamanho,
        "servidor_origem": cred["host"],
        "tabelas_public": con.run("""select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'""")[0][0],
        "contas_auth_users": con.run("select count(*) from auth.users")[0][0],
        "politicas_rls": con.run("select count(*) from pg_policies")[0][0],
        "avisos": d.avisos,
        "ficheiros": sorted(p.name for p in pasta.glob("*.sql")),
    }
    (pasta / "manifesto.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    con.close()

    total = sum(p.stat().st_size for p in pasta.glob("*"))
    print()
    print(f"  pasta: {pasta}")
    print(f"  total: {total:,} bytes em {len(list(pasta.glob('*')))} ficheiros")
    if d.avisos:
        print(f"  AVISOS ({len(d.avisos)}):")
        for a in d.avisos:
            print("    - " + a)
    print()
    print("BACKUP CONCLUÍDO")


if __name__ == "__main__":
    main()
