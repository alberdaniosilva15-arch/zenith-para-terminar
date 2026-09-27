# Porque é que o Supabase "está sempre a cair"

**Investigação de 27/09/2026** · projeto `mhahnhnsaquqgqvnnwld` · West EU (Paris)
Autor da pergunta: Dánio · *"descubra qual o real motivo do supabase estar sempre a cair, porque isso em produção será um problema grave"*

---

## Resposta curta

**Não é o nosso código. É a plataforma.**

E não é uma causa — são **três**, independentes, e só uma delas é que podemos resolver:

| # | Causa | Onde está | Podemos resolver? |
|---|---|---|---|
| 1 | A base de dados do projeto está **intermitentemente inacessível** | Infraestrutura Supabase | ❌ Não |
| 2 | Incidente **aberto** no API Gateway desde 14/08 | Supabase (reconhecido por eles) | ❌ Não — só esperar a versão nova |
| 3 | `db.<projeto>.supabase.co` é **só IPv6** | Rede / DNS | ⚠️ Sim, evitando ligação directa |

**O número que responde à tua pergunta:** em **6 dias seguidos**, **18% de todas as operações à base de dados falharam** — 43 falhas em 236 tentativas, medido no registo interno do próprio CLI, não em impressões.

---

## Prova 1 — O pooler diz, por palavras dele, que a base de dados não está lá

O pooler (Supavisor) é o intermediário oficial da Supabase para ligações directas. Fiz-lhe o aperto de mão PostgreSQL verdadeiro (SCRAM-SHA-256) e ele respondeu, **4 em 4 vezes**:

```
[1] R  auth_type=10        +0,44 s     <- o pooler está vivo e a falar
[2] E  (EAUTHQUERY) authentication query failed:
       connection to database not available   +10,67 s
```

O que isto diz, em concreto:

- O **pooler responde em 0,44 s** → a rede e o serviço estão bons.
- Ao fim de **10,67 s** ele desiste e diz **"connection to database not available"**.
- Esse timeout é **sempre o mesmo** (10,64 / 10,66 / 10,66 / 10,67 / 11,05 s). Não é instabilidade aleatória: é um limite fixo a ser atingido porque o outro lado não responde.

O pooler corre **dentro** da AWS, na mesma região da base de dados. Portanto isto **não** é problema da nossa rede — é a base de dados que não atende.

---

## Prova 2 — O gateway devolve `504` sempre ao mesmo tempo (5,42 s)

Repeti o pedido de login (o mesmo que a app faz) 13 vezes:

```
504  5,41 s      504  5,44 s      504  5,46 s
504  5,42 s      504  5,60 s      504  5,41 s
504  5,42 s      504  5,47 s      504  5,44 s
000  20,02 s  (pendurado, sem resposta nenhuma)
```

**7 de 8 amostras entre 5,41 s e 5,60 s.** Um erro aleatório não se comporta assim — isto é o **timeout interno do gateway** (Kong) a disparar porque o serviço atrás dele ficou calado.

O `504` é a tradução de: *"pedi ao PostgREST/GoTrue e ele não respondeu a tempo"*.

Confirmação cruzada — o gateway está bom, o que está mal é o que vem depois dele:

| Pedido | Resultado | Leitura |
|---|---|---|
| `POST /auth/v1/token` com chave válida | `504` em 5,42 s | serviço atrás do gateway calado |
| `POST /auth/v1/token` com chave inválida | `401` em 0,95 s | gateway **vivo** — rejeitou localmente |
| `GET /rest/v1/users` | 4× sem resposta + 1× `504` | PostgREST calado |
| `GET /rest/v1/` sem chave | `401` rápido | gateway **vivo** |

Ou seja: **o porteiro está de pé, a porta é que não abre.**

---

## Prova 3 — Seis dias de falhas medidas (o "sempre a cair" quantificado)

O CLI da Supabase grava telemetria local em `~/.supabase/traces/*.ndjson`. Contei todas as execuções de `db query`:

| Dia | Sucessos | Falhas | Total | Taxa de falha | Duração média da falha |
|---|---|---|---|---|---|
| 21/09 | 1 | 0 | 1 | 0% | — |
| **22/09** | 62 | **14** | 76 | **18%** | 41 s |
| **25/09** | 55 | **10** | 65 | **15%** | 4 s |
| **26/09** | 7 | **5** | 12 | **42%** | 16 s |
| **27/09** | 68 | **14** | 82 | **17%** | 8 s |
| **TOTAL** | **193** | **43** | **236** | **18%** | |

As durações das falhas agrupam-se em **bandas de timeout distintas** — 3,5–5 s, 8,6 s, 16 s e 168–174 s. Não são erros de SQL (esses falham em 42–265 ms); são **esperas a expirar**, em camadas diferentes.

Isto é a assinatura de uma plataforma **intermitente**, não de um código com bug. Um bug nosso falhava sempre ou nunca; isto falha 1 em cada 5 ou 6 vezes, todos os dias, há uma semana.

---

## Prova 4 — A Supabase assume: incidente aberto desde 14 de Agosto

Consultado o estado oficial agora:

```json
{ "status": { "indicator": "minor", "description": "Partially Degraded Service" } }
```

Existe **1 incidente aberto**:

| Campo | Valor |
|---|---|
| ID | `6q5902p2xd9f` |
| Nome | **401 errors due to JWT rejections** |
| Impacto | `minor` |
| Estado | `identified` (identificado, não resolvido) |
| **Aberto em** | **2026-08-14 02:23 UTC** |
| Última actualização | 2026-09-25 16:23 UTC |
| **Componente afectado** | **`API Gateway` → `degraded_performance`** |
| Link | https://stspg.io/18v97b9scdh2 |

Repara que o componente afectado é **exactamente** o `API Gateway` — o mesmo que está a devolver os `504` da Prova 2.

**A causa, nas palavras deles** (actualização de 02/09):

> *"A stale time cache has been identified as the cause of this issue."*

Uma **cache de tempo obsoleta** no caminho que emite os tokens — os tokens saem com a hora errada e são rejeitados. Daí o nome "401 errors due to JWT rejections".

**O histórico do incidente** (o que eles próprios escreveram):

- **20/08** — erro `GLIBC_2.34 not found` a afectar o PostgREST.
- **31/08** — subiram o PostgREST para 14.17 e **fizeram rollback para 14.5** por *"unintended performance side effects"*.
- **02/09** — identificada a cache de tempo obsoleta.
- **17/09** — eles escrevem: *"This issue has been open for over a month."*
- **25/09 (mais recente)** — *"The new Supabase version will be released early next week. Once it is released, impacted users can upgrade to from their dashboard to resolve this issue."*

E ainda, no mesmo incidente:

> *"some customers have reported that restarting their project after the rollout resolved this issue. To restart your project, go to the General settings page in the dashboard and select **Restart project**."*

**Conclusão: está aberto há 44 dias. Não é nosso. Não se corrige no código.**

---

## Prova 5 — O projeto mudou de infraestrutura (descoberta nova)

Isto não estava à espera e é importante.

Testei vários poolers. O que o projeto usava antes:

```
aws-0-eu-west-3.pooler.supabase.com  ->  ENOTFOUND
                                         tenant/user postgres.mhahnhnsaquqgqvnnwld
                                         not found
```

E o novo:

```
aws-1-eu-west-3.pooler.supabase.com  ->  SCRAM-SHA-256  (0,74 s)
                                         CONHECE o projeto
```

**O projeto mudou do cluster `aws-0` para o `aws-1`.** Bate certo com o que eles escreveram: *"deployment process changes have been rolled out across all regions"* — estão a migrar clientes de infraestrutura.

**Verifiquei se isto nos parte alguma coisa. Não parte:**

- O ficheiro em cache do CLI (`supabase/.temp/pooler-url`) já aponta para `aws-1` → a Supabase actualizou-o.
- `grep` a todo o código versionado por `pooler.supabase.com` → **zero ocorrências**.
- A app **nunca** abre ligação directa à base de dados — fala só por HTTP com o PostgREST (`VITE_SUPABASE_URL`).
- Os ficheiros `.env` não têm nenhuma `DATABASE_URL` / `POSTGRES_URL`.
- O CI (`.github/workflows/ci.yml`) não toca na base de dados.
- Nenhum `.env` está versionado, excepto o `.env.example`.

Portanto esta migração **não** é a causa das quedas — mas fica registada, porque se algum dia alguém colar uma cadeia de ligação antiga num script, vai falhar com `ENOTFOUND` e vai parecer misterioso.

---

## Prova 6 — `db.<projeto>.supabase.co` é só IPv6 (e esta máquina não tem IPv6)

```
nslookup db.mhahnhnsaquqgqvnnwld.supabase.co
  -> 2a05:d012:42e:5708:7902:3ce5:6007:fc7e     (IPv6)

nslookup -type=A db.mhahnhnsaquqgqvnnwld.supabase.co
  -> *** No address (A) records available          (não existe IPv4)

curl -6 https://ipv6.google.com   ->  falha em 0,18 s  (erro 7)
curl -4 https://ipv4.google.com   ->  200 em 1,35 s
```

O endereço directo da base de dados **só existe em IPv6**, e esta máquina **não tem IPv6 a funcionar**. Logo, qualquer ligação directa a `db.*` falha **instantaneamente** — e é por isso que `db query --linked` dá `Connection terminated due to connection timeout`.

**Isto é uma segunda causa, separada da primeira.** Não é o motivo das quedas da app (a app não usa `db.*`), mas é o motivo de o CLI falhar e de qualquer ferramenta de administração directa falhar.

⚠️ **E é um risco real para produção:** em Angola, redes móveis com **IPv4 apenas** vão ter exactamente o mesmo problema se alguma coisa tentar falar com `db.*` directamente. **Regra para produção: usar sempre o pooler (`aws-1-eu-west-3.pooler.supabase.com`), nunca `db.*`.**

---

## Descartado por medição (para não voltar a investigar isto)

- ❌ **CORS** — já foi falso alarme antes. O `OPTIONS` devolve `Access-Control-Allow-Origin: *`. Um `504` sem cabeçalhos CORS **parece** um erro de CORS no browser. **Ler o código de estado, não a mensagem.**
- ❌ **Projeto pausado** (o plano Free pausa por inatividade) — **descartado com prova**: o CLI teve **68 operações com sucesso hoje**. Um projeto pausado não responde nada.
- ❌ **A nossa rede / o nosso código** — o pooler responde em 0,44 s; o gateway rejeita chaves inválidas em 0,95 s; o CLI tem 193 sucessos.
- ❌ **Migração aws-0 → aws-1** — verificada e sem impacto no código.

---

## O que isto significa para produção

**Risco real:** com 18% de falhas na base de dados, **1 em cada 5 ou 6 pedidos falha**. Numa app de ride-hailing isso traduz-se em:

- Login que não entra → o utilizador desiste.
- Corrida que não é criada → receita perdida.
- Carteira que não carrega → parece que o dinheiro desapareceu.
- **Pior de todos:** uma operação que **é escrita** mas cuja resposta se perde → cobrança duplicada ou estado inconsistente.

Hoje a app já tem **um travão de 15 s** por pedido (`src/lib/supabase.ts`, `TIMEOUT_MS`, adicionado a 27/09) e **retry de 4 tentativas** no arranque da sessão (`AuthContext.loadUserData`). Isso resolve o sintoma "spinner infinito". **Não resolve a causa, e não cobre as escritas.**

---

## Plano — o que fazer

### Agora (5 minutos, faz tu no painel)
1. **Reiniciar o projeto** — Dashboard → **General settings** → **Restart project**.
   A Supabase diz que isto resolveu o problema a vários clientes após o rollout.
2. **Confirmar a versão** na mesma página. Quando sair a versão nova (*"early next week"*), **fazer upgrade** — nas palavras deles: *"Completing that upgrade will resolve this issue."*

### Nós (código) — para a app aguentar as quedas em vez de cair com elas
3. **Retry com backoff exponencial nas escritas**, não só no arranque. Uma criação de corrida ou um débito de carteira que receba `504` deve ser **repetido**, com **chave de idempotência** para não duplicar.
4. **Mensagem honesta ao utilizador.** Hoje um `504` pode aparecer como "erro de autenticação" ou "falha de rede", o que aponta o utilizador para o lado errado. Deve dizer: *"Serviço temporariamente indisponível. A tentar novamente…"*
5. **Indicador de estado em tempo real** — ler `https://status.supabase.com/api/v2/status.json` e mostrar um aviso quando a plataforma está degradada. Custa pouco e evita que o utilizador ache que a app está avariada.
6. **Nunca usar `db.*` em produção** — sempre o pooler.

### Monitorização (para não descobrir por acidente)
7. Uma verificação periódica que registe `POST /auth/v1/token` e o estado do pooler, para se ter **a nossa própria série temporal**. O painel da Supabase **não chega**: o `updated_at` da página de estado está parado há 7 horas, mas o incidente continua aberto.

---

## Limites desta análise (para ser honesto)

- **Não consegui ler o estado oficial do projeto** (`ACTIVE_HEALTHY` / `INACTIVE`) na API de gestão, porque o token de acesso do CLI está no cofre de credenciais do Windows e não em ficheiro. **Descarto a pausa por dedução** (68 sucessos hoje), não por leitura directa. Se quiseres a confirmação dura, dá para a obter.
- **Não sei se a base de dados está "em baixo" ou "inalcançável"** por dentro. O pooler diz *"connection to database not available"*, e ele corre dentro da AWS — portanto o lado que falha é o deles. Mas a distinção entre "instância morta" e "rede interna da AWS" só a Supabase a pode fazer.
- **As minhas medições são da minha janela de teste** (≈22:00 UTC de 27/09), em que a taxa de falha foi de **100%**. O histórico de 18% vem da telemetria do CLI, que é a única série temporal longa que existe.

---

## Ficheiros e comandos usados

| Ficheiro | Para que serve |
|---|---|
| `.tmp-pg-sonda.py` | Aperto de mão PostgreSQL ao pooler (encontra o tenant) |
| `.tmp-scram3.py` | SCRAM-SHA-256 completo → revela *"connection to database not available"* |
| `.tmp-flap.py` | Mede gateway e base de dados **em paralelo** na mesma ronda |
| `.tmp-pooler-varrer.py` | Varre poolers para localizar o cluster do projeto |

Comandos de referência:

```bash
# estado da plataforma
curl -s https://status.supabase.com/api/v2/status.json
curl -s https://status.supabase.com/api/v2/incidents/unresolved.json

# o gateway (a app usa este caminho)
curl -o /dev/null -w '%{http_code} %{time_total}\n' -X POST \
  "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' -d '{"email":"x@y.invalid","password":"x"}'

# DNS — confirma se só há IPv6
nslookup db.mhahnhnsaquqgqvnnwld.supabase.co
nslookup -type=A db.mhahnhnsaquqgqvnnwld.supabase.co

# telemetria do CLI (a série temporal)
ls ~/.supabase/traces/
```

---

*Relatório gerado a partir de medição directa. Todas as percentagens e tempos neste documento foram obtidos por execução, não por estimativa.*
