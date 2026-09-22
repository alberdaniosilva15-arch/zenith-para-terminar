# Plano — Kaze, Motorista e Frota

**Data:** 2026-09-22
**Âmbito:** análise pedida pelo Dánio — Kaze/Gemini Live, erros de motorista, passageiro e dono de frota, com prova na base de dados real.
**Regra:** tudo o que está aqui foi **verificado**, não deduzido. Onde não consegui provar, digo-o.

---

## CABEÇA — o diagnóstico

### A. Kaze / Gemini Live

**A1 — O Kaze tem três personalidades que se contradizem.** O mesmo assistente responde de três maneiras diferentes conforme o caminho:

| Caminho | Prompt | O que diz ser |
|---|---|---|
| Voz (Live) | `KAZE_AGENT_SYSTEM_PROMPT` (kazeAppAgent) | "Tu és o KAZE", luandense, gírias, trata por "você" |
| Texto (servidor) | `KAZE_SYSTEM_PROMPT` (gemini-proxy) | "inteligente e omnisciente", **"nunca uses gírias excessivas"** |
| Reserva do cliente | `JARVIS_SECRETARY_SYSTEM_PROMPT` | **"Tu és o KAZE — JARVIS Executivo"**, trata por "Senhor/Chefe/Comandante" |

**Prova:** `grep` dos três. Cada um diz uma coisa diferente sobre quem é e como fala. É literalmente "não conhece a própria personalidade".

**A2 — O caminho de texto inventa a localização.** `KazeMascot.tsx` (~linha 511): se o GPS não responder em 1,2 s, o código escreve `{ lat: -8.8390, lng: 13.2343 }` e a morada `'Luanda'`. O caminho de **voz** proíbe-se explicitamente de o fazer (comentário nas linhas 965-995: *"Não se inventa localização nenhuma"*). Dois caminhos, duas posturas. É o "nem sabe onde está" — sabe, mas errado.

**A3 — O servidor não recebe o bloco do nome.** O `kaze_chat` acrescenta um despejo JSON rotulado *"DADOS OMNISCIENTES DO UTILIZADOR"* em vez do bloco `[ESTÁS A FALAR COM: …]` que a voz usa. O formato diverge entre os dois caminhos.

**A4 — O Kaze está desligado no modo frota.** `AuthenticatedApp.tsx:131`:
`const showKaze = kazeActive && effectiveRole !== UserRole.FLEET_OWNER;`

**A5 — Erros na base de dados** (`ai_usage_logs`, 636 linhas reais):

| Acção | Total | Com erro | Último | Erro |
|---|---|---|---|---|
| `kaze_tts` | 84 | **12** | 21/09 22:20 | HTTP 429 — quota excedida (16-17/09) |
| `get_live_token` | 88 | **1** | 21/09 22:20 | 503 UNAVAILABLE (16/09) |
| `kaze_chat` | 57 | 0 | 21/09 22:20 | — |
| `simulate_earnings` | 183 | 0 | 18/09 | — |
| `admin_sentinel` | 159 | 0 | 31/08 | — |

Os 12 erros de `kaze_tts` são de **16-17/09** e não se repetem — a quota foi reposta. Não é um problema aberto.

### B. Motorista

**B1 — O botão "Modo Motorista" está MORTO.** `set_my_role_driver()` rebenta sempre:

```
HTTP 400 | 23502
"null value in column \"car_brand\" of relation \"driver_documents\" violates not-null constraint"
papel depois: passenger
```

A função é uma transacção única: falha a meio e **desfaz tudo** — o papel fica `passenger`, não cria localização nem documento. **Ninguém consegue tornar-se motorista pela app.** É a causa número um do mercado vazio.

**B2 — A função viva é pior do que o ficheiro de migração.** A versão em produção, *se funcionasse*, faria numa só chamada:
1. papel → `driver`;
2. `driver_locations` → **online e `available`** numa coordenada fixa;
3. `driver_documents` → **`approved`**, sem BI, sem carta, sem carro.

Ou seja: o motorista **aprova-se a si mesmo**. Isso explica os 17 documentos da base estarem **todos** `approved` — nenhum `pending`, nenhum `rejected`.

**B3 — O despacho não verifica nada.** `get_cascade_drivers` filtra **só** por `status = 'available'` e distância. Não olha a documentos, verificação nem papel. Quem estiver "available" é despachado para uma corrida real.

**B4 — Zero motoristas disponíveis.** `driver_locations`: 17 `offline` (último update 19/09 12:37), 2 `busy` (05/09), **0 `available`**. É por isto que o Lukéni nunca encontra motorista: `enviados` é sempre 0.

**B5 — Duas fontes para o carro do motorista.** `driver_vehicles` = **0 linhas** (tabela morta), enquanto o carro vive em `driver_documents` (`car_brand`, `car_model`, `car_plate`).

### C. Dono de frota — "essa zona está mal mesmo"

**C1 — O painel de frota está desligado no código.** `AuthenticatedApp.tsx:24`:

```ts
const FLEET_DASHBOARD_ENABLED = false;
```

E o ternário de render é:
```
passageiro              → PassengerHome
frota && ENABLED        → FleetDashboard     ← nunca acontece
tudo o resto            → DriverHome         ← o dono de frota cai AQUI
```

**Um dono de frota que escolhe "Modo Frota" é atirado para o ecrã de motorista.** É exactamente a confusão que notaste: contas de frota a aparecer como motorista.

**C2 — O comentário ao lado cita um ficheiro que não existe.** Diz *"Ver ZENITH_RIDE_DECISOES_FINAIS_P0_P1.txt"*. Procurei: **não existe**. Ninguém sabe porque é que está desligado.

**C3 — Qualquer passageiro se torna dono de frota com uma chamada.** Provado:
```
set_my_role_fleet_owner -> HTTP 204
papel final: fleet_owner
```
A interface esconde o botão; o RPC não verifica nada.

**C4 — Qualquer passageiro cria uma frota.** Provado:
```
POST /rest/v1/fleets  -> HTTP 201
{"id":"4942a1c1-…","owner_id":"159cf14b-…","name":"Frota Teste…"}
```
A policy de `fleets` só olha `owner_id = auth.uid()`. Não olha ao papel.

**C5 — A área está estruturalmente vazia.** Com **2 frotas** criadas:
`fleet_cars` = 0 · `fleet_driver_agreements` = 0 · `fleet_subscriptions` = 0 · `fleet_billing_events` = 0.
Consequência directa de C1: ninguém conseguiu chegar lá para adicionar um carro.

**C6 — `fleets` não tem plano nem estado.** Só `id, owner_id, name, created_at`. O plano vive em `fleet_subscriptions`, mas o `handleCreateFleet` só insere em `fleets` — **nenhuma subscrição é criada ao criar a frota**.

### D. Passageiro

**D1 —** O fluxo depende inteiramente do despacho, que devolve 0 (B4). 48 das 53 corridas estão `cancelled`.
**D2 —** O bot confirma com um `s` isolado: `CONFIRMA = /^(1|sim|s|ok|…)\b/i`. **"S. Pedro"** é lido como confirmação. (documentado, não corrigido)
**D3 —** O Kaze inventa a localização no texto (A2).

### E. Canais — o que existe para o teste

**E1 — NÃO EXISTE SMS.** Não há Twilio, Africa's Talking nem Vonage — nem nos segredos das Edge Functions, nem no código. Os canais reais são **WhatsApp** (Meta Cloud API: `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`) e **email** (Resend).

**E2 — A IA do admin mente-te.** O `admin-ai-proxy` afirma no seu prompt: *"a app envia SMS silenciosos com GPS para contactos"*. **É falso.** Não há uma linha de código que envie SMS.

**E3 —** O SOS usa WhatsApp e está confirmado a funcionar (provado na sessão anterior).

---

## TRONCO — o plano

### Fase 1 · Segurança e o botão morto *(sem risco, sem decisões)*
| # | O que | Onde |
|---|---|---|
| M1 | Corrigir `set_my_role_driver`: preencher `car_brand`/`car_plate` **ou** deixar de criar documento, e **tirar o auto-approve** — um motorista não se pode aprovar a si mesmo | migração |
| M2 | `set_my_role_fleet_owner`: exigir que exista uma frota do próprio | migração |
| M3 | `fleets` INSERT: exigir papel `fleet_owner` ou admin | migração |

### Fase 2 · Kaze — uma só voz *(sem risco)*
| # | O que |
|---|---|
| M4 | Unificar num único prompt. O do servidor e o JARVIS passam a ser o mesmo que a voz |
| M5 | Tirar a localização inventada do caminho de texto |
| M6 | O servidor passa a receber o bloco `[ESTÁS A FALAR COM: …]` em vez do despejo JSON |
| M7 | Corrigir o texto do `admin-ai-proxy` que promete SMS |

### Fase 3 · Frota *(precisa de uma decisão tua)*
| # | O que |
|---|---|
| M8 | **Decisão:** ligar o `FLEET_DASHBOARD_ENABLED` (o painel já está escrito, 424 linhas) **ou** retirar a opção "Modo Frota" até estar pronta. Não se pode é deixar um dono de frota a ver o ecrã de motorista |
| M9 | Criar a subscrição ao criar a frota |

### Fase 4 · Teste conjunto *(ao vivo, contigo)*

Guião que proponho, ponto por ponto:

| # | Quem faz | O que | Como eu verifico |
|---|---|---|---|
| T1 | Tu | Mandas um **nome** pelo WhatsApp (só o nome, como disseste) | Leio a BD e comparo as coordenadas resolvidas com o sítio **real** desse nome |
| T2 | Tu | Pedes a corrida e confirmas | Vejo a corrida, o preço, o motorista escolhido |
| T3 | Eu | Entro como **motorista** e fico `available` | Confirmo que apareço na cascata e recebo a corrida |
| T4 | Eu | Aceito e avanço os estados | Tu vês no ecrã; eu confirmo na BD |
| T5 | Ambos | A **chamada** | Ver nota sobre a chamada, em baixo |

**Duas limitações honestas, antes de começarmos:**

1. **O SMS não existe.** Se mandares um SMS, não acontece nada — não há gateway. Ou testamos só por WhatsApp, ou decidimos contratar um fornecedor de SMS (é uma decisão de negócio, não de código).
2. **A chamada:** eu não tenho microfone — não consigo literalmente ouvir-te. Consigo abrir a app como motorista, **iniciar** a chamada, e provar ponta-a-ponta que a sessão Agora abre, junta e fecha (canal, eventos, duração). Ouvir a tua voz exige um dispositivo com microfone. Proponho: tu ligas-me, e eu provo o resto por registos.

---

## MEMBRO — o que fica por decidir de uma vez

Preciso de **uma única autorização** que cubra:

1. **Fase 1 + Fase 2** — aplicar as migrações e os patches do Kaze (é o que desbloqueia o mercado e limpa as três personalidades).
2. **Fase 3** — qual dos dois caminhos para a frota: **ligar o painel** ou **retirar a opção**.
3. **Fase 4** — o teste conjunto, com as duas limitações acima aceites.

Assim não te volto a pedir nada a meio.

---

## Anexo — estado real da base (contagens, não estimativas)

`users` 66 · `profiles` 66 · `rides` 53 (48 canceladas, 3 completas, 2 aceites) · `contracts` 15
`fleets` 2 · `fleet_cars` 0 · `fleet_driver_agreements` 0 · `fleet_subscriptions` 0 · `fleet_billing_events` 0
`driver_locations` 19 (17 offline, 2 busy, **0 available**) · `driver_documents` 17 (todos approved) · `driver_vehicles` **0**
`pricing_config` 1 · `service_pricing` 7 · `zone_prices` 35 · `transactions` 0 · `conversation_memory` 0
`tenants` 0 · `ride_safety_checks` 0 · `ride_track_points` 2

Papéis: `admin` 1 · `fleet_owner` 2 · `driver` 27 · `passenger` 36
