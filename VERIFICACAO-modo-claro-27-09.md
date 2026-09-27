# Verificação do Modo Claro — 27/09/2026

Verifiquei por medição, não por leitura do resumo. Abri o app no browser, capturei os dois
temas, compilei, e li o CSS. **Nada foi alterado por mim.**

## Veredicto

| | |
|---|---|
| Destruiu alguma coisa? | **Não.** O modo escuro está intacto. |
| Está bem implementado? | **A base sim, a cobertura não.** O ecrã de login está partido. |
| Está em todas as zonas? | **Falta o login** — que é o primeiro ecrã que toda a gente vê. |

---

## O que está certo (com prova)

**Os ficheiros existem e o `git diff` está limpo** — só 3 ficheiros tocados
(`App.tsx`, `Layout.tsx`, `index.css`), e todos **só acrescentam**. Nada removido.

**A propriedade que mais importava, confirmada:** `zenith-light.css` tem **149 regras e
todas** vivem dentro de `html[data-theme="light"]`. **Zero regras fora do scope.** Isto é
o que garante que o escuro não pode ser afectado — e confirmei-o no bundle final:
`:root` continua com `--bg:#050505`.

**Compila:** `tsc --noEmit` → 0 erros · `vite build` → sucesso em 1m02s.

**O interruptor funciona.** Testei no browser (viewport 430×932):

- escuro `rgb(5,5,5)` → claro `rgb(241,239,234)`
- `data-theme`, `color-scheme` e `<meta theme-color>` acompanham
- clique → animação corre: `clipPath` desce de `inset(900px…)` a `inset(7.5px…)`,
  SVG e overlay visíveis durante, escondidos no fim
- persiste após reload (`zr-theme` no localStorage)

**As zonas autenticadas estão boas.** `DriverHome` (Cockpit), Social feed e Carteira
renderizam correctamente em claro — fundo, cartões, botões dourados e barra inferior
todos coerentes. `.zr-shell` = `rgb(241,239,234)` em todas as abas.

---

## O que está partido

### O ecrã de login em modo claro

Fundo **preto**, campos claros, e o texto quase invisível — "Introdue as tuas
credenciais", "EMAIL", "PALAVRA-PASSE" mal se lêem.

**Causa exacta, encontrada:** `Login.tsx` usa **estilo inline**:

```tsx
312: <div className="zr-shell" style={{ backgroundColor: '#000000' }}>
313:   <div className="zr-app zr-app--login" style={{ backgroundColor: '#000000' }}>
315:     <section className="zr-card zr-card--hero"
                   style={{ backgroundColor: '#000000', backgroundImage: 'none' }}>
```

O CSS claro tem a regra certa — `zenith-light.css:137`,
`html[data-theme="light"] .zr-card--hero { … }` — mas **sem `!important`**.
E **estilo inline só perde para CSS com `!important`**. Por isso o fundo fica preto
enquanto os campos (que são CSS, não inline) ficam claros.

Além disso, `.zr-app` e `.zr-app--login` **não estão cobertos de todo** no CSS claro
(o `grep` confirma zero ocorrências). Há ainda `#1A1A1A` nas linhas 398 e 455.

### Flash escuro ao recarregar

`index.html` não foi tocado e não tem script anti-flash. O `data-theme` só é escrito
pelo `useEffect` do React — **depois** do primeiro paint. E o splash
(`#zenith-splash` + `public/zenith-shell.css`) tem `background: #050912` **fixo**, sem
qualquer tratamento de tema.

Resultado para quem escolheu claro e recarrega: **splash escuro → app escura → claro**.

### Contraste das etiquetas

Na Carteira em claro, "CRÉDITO OPERACIONAL" e "LUCRO LÍQUIDO" ficam dourado-claro sobre
branco — pouco legíveis.

---

## A correcção (quando quiseres)

**Bug do login** — duas opções, e prefiro a segunda:

1. Rápida: acrescentar `!important` às regras de `.zr-shell`, `.zr-card--hero` e criar
   as regras em falta para `.zr-app` / `.zr-app--login`.
2. Melhor: **tirar os `style={{ backgroundColor: '#000000' }}` do `Login.tsx`** e deixar
   o CSS decidir. O inline foi posto para forçar escuro; com dois temas deixa de fazer
   sentido e é o que está a causar o problema.

**Flash** — um script inline no `<head>` do `index.html`, antes do React:

```html
<script>
  try {
    var t = localStorage.getItem('zr-theme');
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  } catch (e) {}
</script>
```

E dar tema ao `zenith-shell.css` (o splash) com
`html[data-theme="light"] #zenith-splash { background: #f1efea; }`.

**Contraste** — subir o `--muted` no modo claro, ou usar o dourado escuro `#a8822c`
só nas etiquetas pequenas.

---

## Nota de método

O `agent-browser` pendurou (daemon, ~3 min sem output) — usei **Playwright directo**, que
já tem precedente neste repo. Detalhe que custou tempo: `b.click()` dentro de
`page.evaluate` **não dispara o onClick do React**; é preciso o `.click()` nativo do
Playwright.
