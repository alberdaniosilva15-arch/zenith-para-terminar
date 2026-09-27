#!/usr/bin/env python
# =============================================================================
# ZENITH RIDE — VERIFICAR UM BACKUP
#
# Um ficheiro criado NÃO é um backup. Este script compara o conteúdo do dump
# com a base de dados viva, contando objecto a objecto.
#
# Uso:
#   "<venv>/Scripts/python.exe" scripts/verificar-backup.py [pasta-do-backup]
#
# Sem argumento, usa a pasta mais recente dentro de backups/.
# =============================================================================

import subprocess, re, sys, json, datetime
from pathlib import Path

try:
    import pg8000.native
except ImportError:
    sys.exit("Falta o pg8000.")

RAIZ = Path(__file__).resolve().parent.parent


def pasta_mais_recente() -> Path:
    base = RAIZ / "backups"
    if not base.exists():
        sys.exit("Não existe a pasta backups/.")
    pastas = sorted([p for p in base.iterdir() if p.is_dir()])
    if not pastas:
        sys.exit("A pasta backups/ está vazia.")
    return pastas[-1]


def ligar():
    r = subprocess.run("npx --yes supabase db dump --linked --schema public --dry-run",
                       capture_output=True, text=True, shell=True, timeout=300)
    saida = r.stdout + r.stderr

    def pegar(n):
        m = re.search(r'export ' + n + r'="([^"]+)"', saida)
        return m.group(1) if m else None

    con = pg8000.native.Connection(user=pegar("PGUSER"), password=pegar("PGPASSWORD"),
                                   host=pegar("PGHOST"), port=int(pegar("PGPORT") or 5432),
                                   database=pegar("PGDATABASE") or "postgres", timeout=180)
    con.run("set role postgres")
    return con


def ler(pasta: Path, padrao: str) -> str:
    ficheiros = sorted(pasta.glob(padrao))
    return "\n".join(f.read_text(encoding="utf-8", errors="replace") for f in ficheiros)


def contar(sql: str, padrao: str) -> int:
    return len(re.findall(padrao, sql, re.IGNORECASE | re.MULTILINE))


def main():
    pasta = Path(sys.argv[1]) if len(sys.argv) > 1 else pasta_mais_recente()
    if not pasta.is_absolute():
        pasta = RAIZ / pasta
    print("=" * 74)
    print("VERIFICAÇÃO DO BACKUP")
    print(f"pasta: {pasta}")
    print("=" * 74)

    if not (pasta / "manifesto.json").exists():
        sys.exit("Não encontrei o manifesto.json — isto não parece um backup.")

    manifesto = json.loads((pasta / "manifesto.json").read_text(encoding="utf-8"))
    print(f"gerado em: {manifesto['gerado_em']}")
    print(f"origem:    {manifesto['servidor_origem']}  ({manifesto['postgres'][:34]})")
    print()

    ddl = ler(pasta, "0[1-4]_*.sql") + ler(pasta, "0[6-9]_*.sql") + ler(pasta, "10_*.sql")
    dados = ler(pasta, "05_*.sql")

    print("--- objectos no ficheiro de backup ---")
    # ATENÇÃO: `create index` sozinho NÃO apanha `create unique index`.
    # Na primeira versão deste script isso deu 145 vs 172 e pareceu que faltavam
    # 27 índices no backup — quando o defeito era do validador. Os 27 estavam lá.
    contagem = {
        "create table":   contar(ddl, r"^\s*create table if not exists"),
        "create function": contar(ddl, r"^\s*create or replace function"),
        "create trigger": contar(ddl, r"^\s*create trigger"),
        "create policy":  contar(ddl, r"^\s*create policy"),
        "create index":   contar(ddl, r"^\s*create (unique )?index"),
        "grant":          contar(ddl, r"^\s*grant "),
        "constraint":     contar(ddl, r"add constraint"),
    }
    for k, v in contagem.items():
        print(f"   {k:<18} {v:>6,}")

    print()
    print("--- a ligar à base viva para comparar ---")
    con = ligar()

    vivos = {
        "create table": con.run("""select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r','p') and not c.relispartition
              and n.nspname in ('public','auth','storage')""")[0][0],
        "create function": con.run("""select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public','auth','storage') and p.prokind in ('f','p')""")[0][0],
        "create trigger": con.run("""select count(*) from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
            where not t.tgisinternal and n.nspname in ('public','auth','storage')""")[0][0],
        "create policy": con.run("""select count(*) from pg_policies
            where schemaname in ('public','auth','storage')""")[0][0],
        "create index": con.run("""select count(*) from pg_index i
            join pg_class c on c.oid = i.indrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public','auth','storage') and i.indisvalid
              and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)""")[0][0],
    }

    print()
    print(f"   {'objecto':<18}{'no ficheiro':>13}{'na base viva':>14}{'resultado':>12}")
    print("   " + "-" * 57)
    problemas = []
    for k in ["create table", "create function", "create trigger", "create policy", "create index"]:
        a, b = contagem[k], vivos[k]
        ok = a == b
        if not ok:
            problemas.append(f"{k}: ficheiro={a} vs vivo={b}")
        print(f"   {k:<18}{a:>13,}{b:>14,}{'OK' if ok else 'DIFERENTE':>12}")

    print()
    print("--- dados: linhas por tabela ---")
    # O nome vem como "schema.tabela" num só grupo (e há nomes com espaços,
    # ex.: `tabela motogo`), por isso não se usa \S+ nem se divide à pressa.
    marcadores = re.findall(r"^-- ---- (.+?) \((\d+) linhas\) ----$", dados, re.MULTILINE)
    soma_ficheiro = sum(int(n) for _, n in marcadores)
    print(f"   tabelas no ficheiro: {len(marcadores)}")
    print(f"   linhas no ficheiro:  {soma_ficheiro:,}")

    soma_viva = 0
    discrepancias = []
    for qualificado, n in marcadores:
        nsp, _, tab = qualificado.partition(".")
        try:
            vivo = con.run(f'select count(*) from "{nsp}"."{tab}"')[0][0]
        except Exception:
            discrepancias.append(f"{qualificado}: não consigo contar na base viva")
            continue
        soma_viva += vivo
        if vivo != int(n):
            discrepancias.append(f"{qualificado}: ficheiro={n} vivo={vivo}")

    print(f"   linhas na base viva: {soma_viva:,}")
    if soma_ficheiro == soma_viva and not discrepancias:
        print("   RESULTADO: OK — todos os dados batem certo")
    else:
        print("   RESULTADO: DIVERGENCIAS")
        for d in discrepancias[:15]:
            print("     - " + d)

    print()
    print("--- integridade do SQL gerado ---")
    for nome, padrao, esperado in [
        ("05_dados.sql",  r"^insert into ", len(marcadores)),
        ("03_tabelas.sql", r"^\s*create table if not exists", vivos["create table"]),
    ]:
        ficheiro = pasta / nome
        if not ficheiro.exists():
            continue
        texto = ficheiro.read_text(encoding="utf-8", errors="replace")
        n = contar(texto, padrao)
        print(f"   {nome}: {n:,} comandos (esperado ~{esperado:,})")

    # --- Ordem das chaves estrangeiras: o teste que faltava ---------------
    #
    # Na primeira versão deste backup, as restrições eram adicionadas logo a
    # seguir a cada tabela. Resultado: 61 de 102 chaves estrangeiras apontavam
    # para tabelas ainda não criadas e a restauração rebentava a meio — apesar
    # de todas as contagens acima estarem certas.
    #
    # ⚠️ O `pg_get_constraintdef` escreve `REFERENCES auth.users(id)` SEM aspas
    # e OMITE o schema quando está no search_path. Uma expressão que exija
    # aspas ou schema falha em silêncio e devolve "0 problemas" — foi o que
    # aconteceu. Aceitar as duas formas.
    print()
    print("--- ordem das chaves estrangeiras (prontidão para restauro) ---")
    ddl_tabelas = ler(pasta, "03_*.sql")

    # ⚠️ Comparar POSIÇÕES NO FICHEIRO, não a ordem alfabética das tabelas.
    # Uma versão anterior comparava a ordem das tabelas e acusava 61 problemas
    # mesmo depois de o dump estar correcto — porque o dump passou a criar
    # TODAS as tabelas primeiro e só depois TODAS as restrições. O que importa
    # é se o CREATE TABLE do alvo aparece ANTES da instrução da chave estrangeira.
    criadas_em = {}
    for m in re.finditer(r'create table if not exists "([^"]+)"\."([^"]+)"', ddl_tabelas):
        criadas_em[(m.group(1), m.group(2))] = m.start()

    RE_FK = re.compile(
        r'alter table only "([^"]+)"\."([^"]+)" add constraint "([^"]+)" '
        r'FOREIGN KEY[^;]*?REFERENCES\s+'
        r'(?:([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(',
        re.IGNORECASE)

    fks, fk_maus = 0, []
    for m in RE_FK.finditer(ddl_tabelas):
        # ⚠️ NÃO usar `con` como nome desta variável: colide com a ligação
        # à base de dados e parte o `con.close()` no fim do script.
        nsp, tab, nome_restricao, ref_nsp, ref_tab = m.groups()
        fks += 1
        alvo = (ref_nsp or nsp, ref_tab)
        if alvo not in criadas_em:
            fk_maus.append(f"{nsp}.{tab} -> {alvo[0]}.{alvo[1]} (tabela alvo não existe)")
        elif criadas_em[alvo] > m.start():
            fk_maus.append(f"{nsp}.{tab} -> {alvo[0]}.{alvo[1]} (alvo criado depois da FK)")

    print(f"   chaves estrangeiras: {fks}")
    if fk_maus:
        print(f"   PROBLEMAS: {len(fk_maus)} — a restauração vai FALHAR")
        for p in fk_maus[:10]:
            print("     ! " + p)
        problemas.append(f"ordem de FKs: {len(fk_maus)} inválidas")
    else:
        print("   OK — todas as tabelas alvo existem quando a FK é criada")

    # Verificações de segurança do próprio ficheiro
    print()
    print("--- verificações de segurança ---")
    if re.search(r"password|PGPASSWORD|service_role_key|eyJhbGciOi", dados + ddl, re.IGNORECASE):
        achados = set(re.findall(r"(?i)(password|service_role_key)", dados + ddl))
        print(f"   ATENCAO: encontrei referencias a {achados} — confirmar antes de partilhar")
    else:
        print("   OK — sem passwords nem chaves de API no dump")

    con.close()

    print()
    if problemas or discrepancias:
        print("VERIFICACAO TERMINADA COM PROBLEMAS")
        sys.exit(1)
    print("VERIFICACAO TERMINADA — BACKUP VALIDO")


if __name__ == "__main__":
    main()
