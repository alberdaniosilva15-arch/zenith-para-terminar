#!/usr/bin/env python
# =============================================================================
# ZENITH RIDE — Extrair um ecra do Figma (API REST, sem OAuth)
#
# PORQUE ISTO EXISTE
#   O servidor MCP do Figma (https://mcp.figma.com/mcp) exige OAuth e **nao
#   aceita token pessoal** — testado: devolve 401 com o token e 401 sem ele,
#   identico, e sem cabecalho WWW-Authenticate.
#
#   Mas a API REST do Figma aceita o token pessoal e faz tudo o que precisamos:
#     - le a arvore do no (cores, tipografia, espacamentos, raios, sombras)
#     - RENDERIZA o no como PNG  <- e isto que permite a comparacao lado a lado
#
# USO
#   python scripts/figma-extrair.py "<link-do-figma>" [pasta-de-saida]
#
#   O link pode ser de ficheiro inteiro ou de uma seleccao (com node-id).
#   No Figma: botao direito numa camada/frame -> "Copy link to selection".
#
# TOKEN
#   Nao escrever o token neste ficheiro. Passar por variavel de ambiente:
#     export FIGMA_TOKEN="figd_..."
# =============================================================================

import json, os, re, sys, urllib.request, urllib.parse, urllib.error, datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
API = "https://api.figma.com/v1"


def token():
    t = os.environ.get("FIGMA_TOKEN")
    if not t:
        sys.exit("Falta a variavel de ambiente FIGMA_TOKEN.\n"
                 '  export FIGMA_TOKEN="figd_..."')
    return t


def pedir(url, tok):
    req = urllib.request.Request(url, headers={"X-Figma-Token": tok})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        corpo = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"Erro {e.code} ao pedir {url[:90]}\n  {corpo}")


def ler_link(link):
    """Aceita varios formatos de link do Figma e devolve (file_key, node_id)."""
    # https://www.figma.com/design/<KEY>/<nome>?node-id=1-234
    # https://www.figma.com/file/<KEY>/<nome>?node-id=1%3A234
    # https://www.figma.com/proto/<KEY>/...
    m = re.search(r"figma\.com/(?:design|file|proto|board)/([A-Za-z0-9]+)", link)
    if not m:
        sys.exit("Nao reconheci o link. Esperava algo como\n"
                 "  https://www.figma.com/design/ABC123/Nome?node-id=1-234")
    chave = m.group(1)

    consulta = urllib.parse.urlparse(link).query
    params = urllib.parse.parse_qs(consulta)
    no = params.get("node-id", [None])[0]
    if no:
        # o Figma usa `1-234` no URL mas `1:234` na API
        no = urllib.parse.unquote(no).replace("-", ":")
    return chave, no


def resumir_no(no, profundidade=0, maximo=2, saida=None):
    """Percorre a arvore e recolhe o que interessa para implementar."""
    if saida is None:
        saida = {"textos": [], "cores": set(), "tipografia": set(),
                 "raios": set(), "espacamentos": set(), "sombras": set(),
                 "tamanhos": []}

    if not isinstance(no, dict):
        return saida

    tipo = no.get("type")
    nome = no.get("name", "")
    caixa = no.get("absoluteBoundingBox") or {}

    if tipo == "TEXT":
        estilo = no.get("style", {}) or {}
        saida["textos"].append({
            "conteudo": (no.get("characters") or "")[:60],
            "fonte": estilo.get("fontFamily"),
            "peso": estilo.get("fontWeight"),
            "tamanho": estilo.get("fontSize"),
            "alturaLinha": (estilo.get("lineHeightPx") or 0),
            "espacamentoLetras": estilo.get("letterSpacing"),
            "cor": (no.get("fills") or [{}])[0].get("color"),
        })
        if estilo.get("fontFamily"):
            saida["tipografia"].add(
                f"{estilo.get('fontFamily')} {estilo.get('fontWeight')} {estilo.get('fontSize')}px")

    for preenchimento in (no.get("fills") or []):
        c = preenchimento.get("color")
        if c:
            r = round(c["r"] * 255); g = round(c["g"] * 255); b = round(c["b"] * 255)
            saida["cores"].add(f"#{r:02x}{g:02x}{b:02x}")

    for contorno in (no.get("strokes") or []):
        c = contorno.get("color")
        if c:
            r = round(c["r"] * 255); g = round(c["g"] * 255); b = round(c["b"] * 255)
            saida["cores"].add(f"#{r:02x}{g:02x}{b:02x} (contorno)")

    for canto in (no.get("cornerRadius"), *(no.get("rectangleCornerRadii") or [])):
        if isinstance(canto, (int, float)) and canto:
            saida["raios"].add(canto)

    for e in (no.get("effects") or []):
        if e.get("type", "").startswith("DROP_SHADOW") and e.get("visible", True):
            c = e.get("color", {})
            saida["sombras"].add(
                f"{round(e.get('offset',{}).get('x',0))}px "
                f"{round(e.get('offset',{}).get('y',0))}px "
                f"{round(e.get('radius',0))}px "
                f"rgba({round(c.get('r',0)*255)},{round(c.get('g',0)*255)},"
                f"{round(c.get('b',0)*255)},{round(c.get('a',1),2)})")

    if tipo in ("FRAME", "COMPONENT", "INSTANCE", "GROUP"):
        if caixa:
            saida["tamanhos"].append(
                f"{nome[:34]}  {round(caixa.get('width',0))}x{round(caixa.get('height',0))}")

    for campo in ("paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
                  "itemSpacing"):
        v = no.get(campo)
        if isinstance(v, (int, float)) and v:
            saida["espacamentos"].add(f"{campo}={v}")

    for filho in (no.get("children") or []):
        resumir_no(filho, profundidade + 1, maximo, saida)

    return saida


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    link = sys.argv[1]
    tok = token()

    chave, no = ler_link(link)
    print("=" * 72)
    print("EXTRAIR DO FIGMA")
    print("=" * 72)
    print(f"  ficheiro: {chave}")
    print(f"  no:       {no or '(ficheiro inteiro)'}")

    # --- metadados do ficheiro ---
    if no:
        dados = pedir(f"{API}/files/{chave}/nodes?ids={urllib.parse.quote(no)}", tok)
        nos = dados.get("nodes", {})
        if not nos:
            sys.exit("O ficheiro respondeu mas sem esse no. Confirmar o node-id.")
        primeiro = list(nos.values())[0]
        doc = primeiro.get("document", {})
        nome = doc.get("name", "?")
    else:
        dados = pedir(f"{API}/files/{chave}", tok)
        doc = dados.get("document", {})
        nome = dados.get("name", "?")

    print(f"  nome:     {nome}")

    marca = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    pasta = Path(sys.argv[2]) if len(sys.argv) > 2 else RAIZ / "figma" / marca
    pasta.mkdir(parents=True, exist_ok=True)

    # --- arvore completa ---
    (pasta / "no-completo.json").write_text(
        json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  arvore guardada: no-completo.json")

    # --- resumo legivel ---
    r = resumir_no(doc)
    linhas = []
    linhas.append(f"# {nome}")
    linhas.append(f"\nExtraido em {datetime.datetime.now().isoformat(timespec='seconds')}")
    linhas.append(f"\n## Cores encontradas ({len(r['cores'])})")
    for c in sorted(r["cores"]):
        linhas.append(f"- `{c}`")
    linhas.append(f"\n## Tipografia ({len(r['tipografia'])})")
    for t in sorted(r["tipografia"]):
        linhas.append(f"- {t}")
    linhas.append(f"\n## Raios de canto")
    for v in sorted(r["raios"]):
        linhas.append(f"- {v}px")
    linhas.append(f"\n## Espacamentos")
    for v in sorted(r["espacamentos"]):
        linhas.append(f"- {v}")
    linhas.append(f"\n## Sombras")
    for v in sorted(r["sombras"]):
        linhas.append(f"- `{v}`")
    linhas.append(f"\n## Tamanhos dos blocos")
    for v in r["tamanhos"][:40]:
        linhas.append(f"- {v}")
    linhas.append(f"\n## Textos ({len(r['textos'])})")
    for t in r["textos"][:40]:
        linhas.append(f"- \"{t['conteudo']}\" — {t['fonte']} {t['peso']} "
                      f"{t['tamanho']}px, linha {round(t['alturaLinha'])}px")
    (pasta / "RESUMO.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print(f"  resumo: RESUMO.md  ({len(r['cores'])} cores, {len(r['tipografia'])} estilos de texto)")

    # --- renderizar como PNG (a peca-chave para comparar) ---
    if no:
        print("  a renderizar o no como PNG...")
        img = pedir(f"{API}/images/{chave}?ids={urllib.parse.quote(no)}"
                    f"&format=png&scale=2", tok)
        url = (img.get("images") or {}).get(no)
        if url:
            destino = pasta / "figma.png"
            urllib.request.urlretrieve(url, destino)
            print(f"  imagem: figma.png  ({destino.stat().st_size:,} bytes)")
        else:
            print("  nao consegui renderizar (o Figma nao devolveu URL)")
    else:
        print("  (sem node-id nao renderizo — passa o link de uma seleccao)")

    print()
    print(f"PASTA: {pasta}")


if __name__ == "__main__":
    main()
