# Verificação do Plano de Correcções v3.4 contra o projecto

**Data:** 25 de Setembro de 2026
**Documento verificado:** `Plano-Correcoes-Zenith-Ride-v3.4tttt.pdf` (24/09/2026)
**Commit em análise:** `6d3f071` — *"fix: correcoes criticas v3.4 - chat, chamadas, contratos, kaze AI, whatsapp webhook"*
**Produção verificada:** `zenith-ride-build.vercel.app` (bundle `index-C14S4VTE.js` — igual ao `dist/` local)
**BD verificada:** `mhahnhnsaquqgqvnnwld.supabase.co` (consulta directa)

---

## ✅ ACTUALIZAÇÃO — o que já foi corrigido (25/09, mesmo dia)

O bloqueio central deste relatório **já não existe**. Foi corrigido e aplicado:

| O que | Onde | Prova |
|---|---|---|
| Migração v3.4 corrigida (3 alterações) e **aplicada** | `20260924220000_plano_v34_correcoes_criticas.sql` | Dry-run + aplicação + verificação objecto a objecto |
| Colunas premium dos contratos + Zenith Pass | `20260925110000_contratos_premium_e_zenith_pass.sql` (nova) | `contracts` e `profiles` conferidos |

**Já a funcionar em produção, sem deploy de cliente:**

- **Chat** — `ride_messages.client_id` existe. O `insert` do cliente foi testado contra a API real:
  devolveu `401 row-level security` (a anon key não é participante da corrida), **não** `42703 coluna
  inexistente`. É a prova de que o PostgREST aceita o payload.
- **Contratos** — a lista carrega (`select` → **HTTP 200**). Havia um **segundo** bug, de 07/05/2026,
  independente do v3.4: o `Contract.tsx:49` pedia quatro colunas de crédito que nunca existiram, e o
  `:50` pedia três colunas do Zenith Pass. Os dois selects devolviam 400 e o ecrã não abria.
- **`accept_ride_atomic` confirmada intacta** — a versão viva (melhor) não foi substituída.
- **Backfill** — as 15 linhas de `contracts` ficaram com `dest_address` preenchido e
  `payment_status = 'pending'`.
- **Três problemas de segurança fechados pelo caminho:** `rides_status_audit` e
  `notifications_outbox` ficavam sem RLS (expostas à anon key, que é pública), e o
  `broadcast_ride_change` falhava em silêncio absoluto — agora deixa `WARNING` no log.

**Verificado a disparar:** `bump_ride_version` (0→1), `audit_rides_status` (registou
`cancelled → searching`) e `realtime.send` da BD (executa sem erro).

**Continua por fazer** — o resto deste relatório mantém-se válido: canais Realtime privados
(as políticas existem mas o cliente ainda subscreve público), `senderId || myId` no `RideChat`,
`broadcastRideUpdated` vivo, a frase falsa do Kaze, o circuit breaker inerte, a Fase 6 e a
observabilidade. Ver a secção 5 para a ordem.

> Nota: `notifications_outbox` continua a ser **só esquema** — não existe worker que a consuma.
> As linhas acumulam-se sem serem processadas.

---

## Veredicto em uma linha

**Não.** O plano está implementado no **código do cliente**, mas os objectos de base de dados de que esse código depende **nunca foram criados**. Como o cliente já está em produção, há **duas funcionalidades partidas neste momento** — o chat e a criação de contratos.

---

## 1. O achado que muda tudo: a migração nunca correu

`supabase/migrations/20260924220000_plano_v34_correcoes_criticas.sql` foi **escrita e commitada**, mas não está na base de dados.

Estado real da BD de produção:

| Objecto esperado pelo plano | Existe em produção? |
|---|---|
| `rides_status_audit` (tabela de auditoria) | **não** |
| `rides_searching_has_no_driver` (CHECK) | **não** |
| `rides.version` (versão monotónica) | **não** |
| `bump_ride_version`, `audit_rides_status` | **não** |
| `broadcast_ride_change` (broadcast na BD) | **não** |
| `ride_messages.client_id` + índice único | **não** |
| `contracts.origin_address / origin_lat / origin_lng / dest_address` | **não** |
| `notifications_outbox` | **não** |
| Políticas em `realtime.messages` | **0 políticas** |

A `contracts` real só tem `address`, `dest_lat`, `dest_lng`. A `ride_messages` real só tem `id, ride_id, sender_id, text, created_at`.

### Porque é que a migração não correu — provado

Corri a migração num **dry-run dentro de uma transacção com `rollback`**. Falha logo na primeira instrução da Fase 0:

```
ERROR: 42501: must be owner of table messages
CONTEXT: SQL statement "alter table realtime.messages enable row level security"
```

A `realtime.messages` pertence a `supabase_realtime_admin`; a migração corre como `postgres`. E o RLS **já estava activo** — essa linha é desnecessária.

Removendo essa linha, o `create policy` em `realtime.messages` **funciona** (testei, com rollback). Mas a migração rebenta mais à frente, na Fase 1:

```
ERROR: 42P13: cannot change return type of existing function
HINT: Use DROP FUNCTION accept_ride_atomic(uuid) first.
```

Isto explica os dois sintomas ao mesmo tempo: quem tentou aplicar, viu falhar e a transacção inteira reverteu. **Nada ficou aplicado.** Mas o commit foi feito na mesma, e o cliente foi para produção a depender dessas colunas.

---

## 2. Consequência imediata: o que está partido agora

### Chat 100% inoperante
O bundle que está **a servir em produção** faz:

```js
R.from("ride_messages").insert({ ride_id, sender_id, text, client_id }).select().single()
```

A coluna `client_id` não existe → o PostgREST rejeita com `400 / PGRST204`. Toda a mensagem falha, a UI mostra *"Falhou · Tocar para reenviar"*, e o reenvio usa o mesmo `client_id` → falha outra vez. Não é intermitente: é sempre.

### Criação de contratos inoperante
`src/components/Contract.tsx:147` monta o payload com `origin_address`, `dest_address`, `origin_lat`, `origin_lng` — nenhuma destas colunas existe. O insert devolve erro e o utilizador vê *"Erro: ..."*. O tratamento de erro é honesto (não falha em silêncio), mas a funcionalidade não funciona.

---

## 3. Fase por fase

### Fase 0 — Segurança

| Item | Estado | Nota |
|---|---|---|
| 0.1 Chaves fora do bundle | **Parcial** | Objectivo cumprido: zero `gsk_`/`AIza` no `src/`, no `dist/` e no bundle de produção. Mas `kazeKey.ts` continua a existir (é um túmulo documentado que devolve `''`), e `FRONTEND_GROQ_KEY`, `FRONTEND_GEMINI_KEY` e `callDirectJarvisChat` continuam no código como peso morto. O plano mandava **apagar**. |
| 0.2 Canais Realtime privados | **Não feito** | `grep "private: true" src/` = **zero**. O cliente continua em canais públicos. As políticas não existem na BD. |
| 0.3 `admin-ai-proxy` valida papel | **Feito** | `dbUser.role !== 'admin'` → 403. |

**Bug adicional na política da migração:** o cliente subscreve o chat como `ride_chat_${rideId}` (**underscore**) mas a política testa `'ride_chat:' || id` (**dois pontos**). Mesmo com a migração aplicada, esse tópico nunca seria autorizado.

### Fase 1 — Estado da corrida

| Item | Estado |
|---|---|
| Tabela de auditoria + trigger | **Não existe na BD** |
| `CHECK rides_searching_has_no_driver` | **Não existe na BD** |
| `version` + `bump_ride_version` | **Não existe na BD** — o guard do cliente (`typeof incVersion === 'number'`) fica inerte |
| RPC atómica | **Conflito.** Ver abaixo |
| Broadcast emitido pela BD | **Não existe.** E `rideService.broadcastRideUpdated` continua vivo e a ser chamado (linhas 844 e 931) — o plano mandava apagar |
| Máquina de estados monotónica | **Feito** no cliente (`lastVersionRef`, `resolveDriverConfirmed`, rede de segurança com log) |

**Atenção ao `accept_ride_atomic`.** A função **viva na BD não é a da migração** — e é melhor:

- **Viva:** devolve `jsonb {success, reason}`; verifica `is_driver()`; exige `driver_locations.status='available'`; usa `FOR UPDATE NOWAIT`; grava `driver_confirmed = TRUE`; põe o motorista `busy`.
- **Migração:** devolve `public.rides`; não verifica papel nem disponibilidade; não marca o motorista ocupado.

Aplicar a migração às cegas **substituiria a boa pela pior** — e de qualquer forma nem sequer compila, por causa do tipo de retorno.

O cliente sabe lidar com as duas formas (normaliza `{success}` e `DbRide`), por isso hoje está bem. É a migração que está errada.

**O passageiro não fica preso** — o cliente também escuta `postgres_changes` em `rides` como caminho de recurso, e esse caminho funciona sem trigger nenhum.

### Fase 2 — Chat

| Item | Estado |
|---|---|
| Coluna `client_id` + índice único | **Não existe na BD** → chat partido |
| `senderId` de `getSession`, sem fallback | **Não feito** — `RideChat.tsx:59`: `const senderId = session?.user?.id \|\| myId;`. É exactamente o que o plano proíbe. |
| Ler `error` do insert | **Feito** |
| Dedupe por `client_id` | **Feito** |
| Polling só em modo degradado | **Parcial** — passou de 3s para 8s, mas a condição é `!isSubscribedRef.current \|\| document.visibilityState === 'visible'`. Com o `||`, continua a fazer polling com o Realtime saudável. |

### Fase 3 — VoIP — **a fase mais bem feita do plano**

- ✅ `useLatest` para `endCall`, `showToast`, `onEndCall`, `callState`
- ✅ `callId` único em `CALL_INIT` / `CALL_ACCEPT` / `CALL_REJECT` / `CALL_END`
- ✅ Dependências do `useEffect` estritas: `[corridaId, userId]`
- ✅ Token Agora por Edge Function, expiração 3600s, **uid numérico derivado do UUID** (distinto por participante)
- ✅ Timeouts explícitos (18s conexão, 8s token)
- ✅ Permissão de microfone **antes** do join, com mensagem clara em vez de chamada que cai
- ✅ `user-left` + `connection-state-change`
- ❌ **Item 3.6 em falta:** nem tabela `calls`, nem push FCM. O receptor com a app em background continua sem ser tocado.

### Fase 4 — Contratos

- ❌ Migração não aplicada → **criar contrato partido em produção**
- ❌ `AddContractForm.tsx:127` continua a escrever `dest_address` **e** `address` — as duas fontes de verdade que o plano queria eliminar
- ✅ `splitTextToSize` presente em `pdfService.ts` (moradas longas)
- ✅ Sem emojis nos títulos do PDF
- ✅ Leitura tolerante a contratos antigos (`dest_address || address`)

### Fase 5 — Kaze

| Item | Estado |
|---|---|
| `admin-ai-proxy` como caminho único | **Parcial** — existe, valida admin, e monta métricas **no servidor** (`from('rides').select(count)`). Mas o cliente ainda tem 3 cadeias de fallback. |
| Modelos em `KAZE_PRIMARY_MODEL` / `KAZE_FALLBACK_MODEL` | **Não feito** — variáveis não existem; modelos fixos no código |
| Resposta fixa "Sistemas operacionais online, Comandante" | **Continua** — `geminiService.ts:954` |
| Circuit breaker | **Inerte** — `consecutiveFailures` é declarado e reposto a 0, mas **nunca é consultado**. Não há limiar nem espera de 30s. |
| Transcrição via Edge Function | **Feito** — `kaze_transcribe`, chave fora do cliente |
| VAD afinado com dados | **Não feito** — `noiseFloor: 0.06` continua a ser constante às cegas; sem medidor de nível em debug |

**Efeito colateral sério:** como `FRONTEND_GROQ_KEY` e `FRONTEND_GEMINI_KEY` agora devolvem `''`, o passo 3 (`callDirectJarvisChat`) **falha sempre**. Logo, sempre que o `gemini-proxy` falha, a resposta é garantidamente a frase falsa *"Sistemas operacionais online, Comandante"*. O plano avisou precisamente sobre isto: *"Isso esconde a avaria."*

### Fase 6 — WhatsApp

| Item | Estado |
|---|---|
| Templates Meta submetidos | **Não** — nomes só aparecem num comentário SQL |
| `whatsapp_opt_in_at` no perfil | **Não existe** |
| `notifications_outbox` + worker | **Não existe** — e **não há nada no projecto que processe a fila**. Mesmo aplicada, a notificação ficaria pendente para sempre. |
| Assinatura `X-Hub-Signature-256` | **Feito** |
| Disparo no servidor | **Não** — `notifyPassengerRideAccepted` continua a ser um `fetch` do telemóvel do motorista |

### Transversal

- ❌ **Observabilidade:** sem Sentry, sem `ride_accept_latency_ms`, sem `call_drop_reason`, sem `kaze_route` / `kaze_degraded`. Só existe `console.warn('chat_send_failed')`.
- ❌ **Feature flags** `ff_ride_broadcast_db`, `ff_chat_v2`, `ff_call_v2`: não existem. Sem rollback sem novo build.
- ❌ **Matriz de testes:** não executada.
- ⚠️ **Ordem de deploy:** não seguida — o cliente foi publicado antes das migrações, que é exactamente o inverso do que o plano manda (ponto 11.2: *"Migrações aditivas"* primeiro).

---

## 4. Resumo por fase

| Fase | Veredicto |
|---|---|
| 0 — Segurança | 🟡 Parcial (chaves OK, canais privados não) |
| 1 — Estado da corrida | 🔴 Cliente pronto, BD ausente, RPC em conflito |
| 2 — Chat | 🔴 **Partido em produção** |
| 3 — VoIP | 🟢 Quase completo (falta item 3.6) |
| 4 — Contratos | 🔴 **Partido em produção** |
| 5 — Kaze | 🟡 Parcial |
| 6 — WhatsApp | 🔴 Quase nada |
| Transversal | 🔴 Observabilidade e flags ausentes |

---

## 5. Ordem de correcção recomendada

**Antes de tudo — parar a hemorragia.** Duas opções para o chat e os contratos:

- **Opção A (rápida, horas):** aplicar as migrações aditivas em falta. É o caminho que o plano desenha.
- **Opção B (imediata):** reverter o cliente para não escrever as colunas inexistentes.

**Depois, pela ordem:**

1. **Corrigir a migração** (3 alterações concretas):
   - remover `alter table realtime.messages enable row level security` — já está activo e não temos a posse;
   - **não** substituir o `accept_ride_atomic` vivo — a versão da BD é melhor;
   - alinhar o nome do tópico: `ride_chat_` (cliente) vs `ride_chat:` (política).
2. Aplicar as migrações aditivas e confirmar objecto a objecto na BD.
3. Ligar os canais privados no cliente (`{ config: { private: true } }`) — **só depois** das políticas existirem, senão o Realtime inteiro cai.
4. Apagar `broadcastRideUpdated` e a resposta falsa do Kaze.
5. Tirar o `|| myId` do `RideChat`.
6. Fase 6 e observabilidade.

---

## 6. Notas de método

- A BD foi consultada directamente (`information_schema`, `pg_class`, `pg_proc`, `pg_policies`) — não por leitura de migrações.
- A migração foi testada num **dry-run com `rollback`**, para provar os dois bloqueios sem alterar nada.
- O bundle de produção foi descarregado e comparado com o `dist/` local: o hash de entrada é **igual** (`index-C14S4VTE.js`), logo produção = repo actual.
- Para testar um `select` ou um `insert` sem browser: extrair a `anon key` do bundle público (é
  pública por desenho) e bater na API REST. Um `400 / 42703` acusa coluna inexistente; um
  `401 / 42501` prova que o payload foi aceite e só a RLS travou. É essa a diferença que interessa.
- Ficheiros de rascunho da verificação já removidos. Os artefactos que ficam são as duas migrações
  e este relatório.
