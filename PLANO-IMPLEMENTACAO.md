# Plano de implementação — Zenith Ride

**28/09/2026** · Estado actual: `04c2469` em produção · modo claro publicado

---

## Como este plano está organizado

Está por **ordem de execução**, não por importância. A Fase 1 é a que decidiste
fazer primeiro. As outras estão ordenadas para não haver trabalho deitado fora —
por exemplo, não vale a pena polir os modais agora se a Fase 1 os vai redesenhar.

Cada item diz **quem faz**: 🧑 = tu (preciso de uma decisão ou de um clique teu) ·
🤖 = eu · 🧑🤖 = os dois.

---

# FASE 1 — Refazer a UI a partir do Figma 🧑🤖

Esta é a prioridade. O objectivo é a app ficar **igual aos teus ficheiros**, não
"parecida".

## 1.1 Preparação (bloqueada em ti)

| # | O quê | Quem |
|---|---|---|
| 1.1.1 | Configurar o servidor Figma MCP | ✅ feito — `~/.workbuddy-ai/mcp.json` |
| 1.1.2 | **Confiar no conector** — abrir a gestão de conectores, entrar em *custom connectors* e clicar **Trust** no `Figma` | 🧑 |
| 1.1.3 | Ter conta Figma com lugar **Full** ou **Dev** (o MCP exige) | 🧑 |
| 1.1.4 | Enviar os links dos ficheiros/ecrãs | 🧑 |

⚠️ **Como o servidor remoto funciona:** ele é **por link**. Não vê o teu Figma
sozinho — preciso que copies o link do que queres. No Figma: clicar com o botão
direito numa camada ou frame → **Copy link to selection**. Isso traz o ID do nó e
limita a leitura àquele ecrã. Sem selecção, o link do ficheiro inteiro também serve.

⚠️ **A autenticação é OAuth no browser** — não há chave para colar. Na primeira
utilização vai abrir uma janela para autorizares.

## 1.2 Ordem das zonas

Sugiro esta ordem, mas dizes-me se queres outra:

| Ordem | Zona | Porquê nesta posição |
|---|---|---|
| 1 | **Entrada / Login** | é o que todos veem primeiro; define a linguagem |
| 2 | **Home do passageiro** | o ecrã mais usado; tem o mapa e a prévia de rota |
| 3 | **Carteira** | dinheiro — erro aqui custa confiança |
| 4 | **Histórico / Recibos** | mais simples, consolida os padrões |
| 5 | **Home do motorista** | ecrã de trabalho; tem estado em tempo real |
| 6 | **Frota** | menos usado |
| 7 | **Perfil / Definições** | |
| 8 | **Modais** (carga, fretamento, motorista privado) | hoje ainda estão escuros no modo claro |

## 1.3 Como vamos garantir que fica **igual**

Isto é o que separa "parecido" de "igual" — e é o que já usámos no modo claro:

1. Leio o nó do Figma (cores, espaçamentos, tipografia, raios, sombras).
2. Implemento.
3. **Tiro captura à app e comparo com o Figma** — mesma largura de ecrã.
4. **Sobreponho as duas imagens** e mostro-te a diferença, não uma descrição.
5. Corrijo e repito até a diferença ser nula.

⚠️ **Dois temas, sempre.** Tudo o que fizermos tem de ficar bem no claro **e** no
escuro. O Figma costuma ter só uma versão — quando não tiver as duas, digo-te e
decidimos juntos em vez de eu inventar.

⚠️ **Regra que já nos custou tempo:** as cores do Figma vêm em `oklch()`. Já tenho
o conversor exacto para sRGB (`.tmp-oklch.mjs`) — não vou arredondar a olho.

## 1.4 Definição de pronto

- [ ] Comparação lado a lado sem diferenças visíveis
- [ ] Contraste ≥ 4,5 nos dois temas (a auditoria `.tmp-contraste.mjs` dá 0 falhas)
- [ ] `tsc --noEmit` limpo e build OK
- [ ] Nenhuma regressão no tema oposto

---

# FASE 2 — Pendentes rápidos (posso fazer já)

## 2.1 Já resolvido neste turno 🤖
- ✅ **`<meta http-equiv="X-Frame-Options">` removido.** Era inválido e gerava aviso
  na consola. Os cabeçalhos verdadeiros já vêm do `vercel.json` (HSTS, CSP com
  `frame-ancestors 'none'`, X-Frame-Options, Referrer-Policy, Permissions-Policy).
  Tirei os que o browser ignora em `<meta>`; ficou só o `Referrer-Policy`, que é
  respeitado e serve de rede no dev local.
- ✅ **Figma MCP configurado** e validado.

## 2.2 Limpeza do repositório 🤖
Há dezenas de ficheiros `.tmp-*` na raiz (scripts de diagnóstico das sessões
anteriores) e pastas `.tmp-dist-*` de builds de verificação.

⚠️ **Não vou apagar às cegas.** O shim de segurança bloqueia mais de 50 remoções
por turno e já houve um caso em que um `.tmp-sessao.mjs` era prova de um achado de
segurança antigo. Proponho: **listar primeiro**, marcar o que é descartável, e
mover para uma pasta `_tmp-arquivo/` em vez de apagar. Tu confirmas e depois
limpamos de vez. Esforço: baixo. Risco: baixo se for por etapas.

## 2.3 Os 2 ficheiros de segurança pendentes 🧑🤖
- 3 linhas em `transactions` que bloqueiam a criação do `CHECK (amount > 0)`
- **6 contas de teste** em `users` (o `DELETE` em `profiles` não as levou)

Preciso da tua luz verde porque são **dados de produção**. Faço primeiro um
`SELECT` a mostrar exactamente o que vai ser apagado, tu confirmas, e só depois
apago. Nunca ao contrário.

---

# FASE 3 — Pôr isto a aguentar 100 mil utilizadores

Esta é a fase que decide se a app sobrevive ao crescimento. Está bloqueada numa
decisão tua.

## 3.1 Decidir o plano do Supabase 🧑
O Free **não chega**: 500 MB de base e 50 000 utilizadores activos/mês, sem
backups, e pausa após uma semana sem uso. Tu falaste em 10 mil/dia e 100 mil users.

**Pro ($25/mês)** = 8 GB, 100 000 MAU, **backups diários automáticos**, nunca
pausa, e desbloqueia o **"Restore to a new project"** — que é a cópia para outra
base que pediste, feita pela Supabase num clique.

→ **Preciso: sim ou não ao Pro.** Sem isto, o resto da Fase 3 fica em espera.

## 3.2 A app aguentar-se quando a plataforma cai 🤖
Já sabemos que o Supabase cai (medido: **18% de falhas em 6 dias**). A app hoje
tem tecto de 15 s por pedido e 4 tentativas no arranque — mas **as escritas não
têm retry**. Falta:

| # | O quê | Porquê |
|---|---|---|
| 3.2.1 | **Retry com backoff exponencial nas escritas** | uma corrida ou um débito que receba `504` hoje perde-se |
| 3.2.2 | **Chave de idempotência** | sem isto, o retry **cobra duas vezes**. Os dois andam juntos ou não andam. |
| 3.2.3 | **Mensagem honesta ao utilizador** | hoje um `504` pode aparecer como "erro de autenticação" e aponta para o lado errado |
| 3.2.4 | **Indicador de estado da plataforma** | ler `status.supabase.com` e avisar; evita que o utilizador ache a app avariada |

⚠️ **Ordem obrigatória: 3.2.2 antes de 3.2.1.** Retry sem idempotência numa app
com carteiras é pior do que não ter retry nenhum.

## 3.3 Cópia de reserva num 2.º projecto 🧑🤖
O dump está feito e verificado. Falta criar o projecto de destino e restaurar.
→ **Preciso: queres a base de reserva agora, ou esperamos pelo Pro?** Se for pelo
Pro, o "Restore to a new project" faz isto nativamente e poupa trabalho.

---

# FASE 4 — Segurança (o que ficou da vaga do pentest)

| # | O quê | Quem | Nota |
|---|---|---|---|
| 4.1 | **F-02** — decisão de política | 🧑 | não é bug; é uma escolha tua |
| 4.2 | **F-06** — gate de documentos **no servidor** | 🤖 | hoje só existe na UI; não está provado que trave |
| 4.3 | **F-04** — Confirm email = ON | 🧑 | é um clique no painel |
| 4.4 | Verificação final dos 4 fechados | 🤖 | repetir os testes HTTP e deixar registado |

⚠️ O F-06 é o mais sério dos três: um gate que só existe na interface é uma porta
com o puxador pintado na parede. Passa a ser tratado **no servidor**, com prova.

---

# FASE 5 — Acabamento

- 5.1 Varrimento de contraste em **todas** as rotas (hoje só cobri 4)
- 5.2 Os modais que ainda estão escuros no modo claro (se a Fase 1 não os apanhar)
- 5.3 Automatizar o backup (correr sozinho de tempo em tempo, guardar fora do repo)
- 5.4 Documentação para quem entrar no projecto a seguir

---

## Resumo — o que preciso de ti

| # | Decisão | Bloqueia |
|---|---|---|
| 1 | **Confiar no conector Figma** + enviar os links | **Toda a Fase 1** |
| 2 | Ordem das zonas (ou aceitar a minha) | Fase 1 |
| 3 | **Sim ou não ao Pro** | Fase 3 inteira |
| 4 | Luz verde para apagar os dados de teste | Fase 2.3 |
| 5 | Base de reserva: agora ou depois do Pro | Fase 3.3 |
| 6 | F-02: qual das duas políticas | Fase 4.1 |

**Sem o nº 1 eu não arranco a Fase 1.** Todo o resto posso ir fazendo.

---

## O que fica pronto assim que disseres "avança"

Posso começar **já** por: 2.2 (limpeza, com listagem prévia) · 3.2.2 e 3.2.1
(idempotência primeiro) · 3.2.3 · 3.2.4 · 4.2 · 4.4. Nada disto precisa de
decisões tuas nem de mexer em dados.
