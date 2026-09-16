# Bot Lukéni / WhatsApp — o que ficou pronto e como testar

**Data:** 2026-09-15
**Âmbito:** pedido de corrida por WhatsApp até chegar ao motorista

---

## 1. O que estava partido

Não era um problema — eram cinco, em cadeia, e **nenhum dava erro**. Todos respondiam "sucesso".

| # | Problema | Consequência |
|---|---|---|
| 1 | O bot é um workflow **n8n** e o n8n **não está instalado** (nem no Windows, nem no Kali, nem em Docker) | O bot não tinha onde correr |
| 2 | O n8n encaminhava para o Supabase **sem autenticação** | O webhook responde **401** |
| 3 | O webhook lia `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` — mas os secrets chamam-se **`WA_ACCESS_TOKEN`** / **`WA_PHONE_NUMBER_ID`** | Caía no ramo "mock": escrevia no log e devolvia `true` sem enviar nada |
| 4 | `get_cascade_drivers` devolvia **`u.email`** na coluna `phone` | O envio ia para o número literal **"244"**. O motorista nunca recebia |
| 5 | O handler de mensagens recebidas era um **stub** (só `ACEITAR xxx` + saudação fixa) | O fluxo de pedido de corrida não existia |

Além disso, dentro do próprio bot n8n: as **mensagens de localização eram descartadas** antes
de chegarem ao detector de corrida, e havia uma **credencial hardcoded** na deduplicação.

Provas: `whatsapp_sessions`, `bot_conversations`, `message_dedup` e `conversation_memory`
tinham **0 linhas** — nenhuma mensagem foi alguma vez processada.

---

## 2. O que ficou feito

### Código

- **`supabase/functions/whatsapp-webhook/index.ts`** — reescrito. Agora tem o fluxo completo:
  localização → destino → geocodificação → preço → confirmação → criação da corrida →
  notificação dos motoristas → aceitação pelo motorista → aviso ao passageiro.
- **`supabase/migrations/20260915190000_fix_cascade_driver_phone.sql`** — o RPC passou a
  devolver `profiles.phone` em vez do email.
- **`supabase/functions/dispatch-cascade/index.ts`** — deixou de engolir falhas: verifica a
  resposta da Meta e regista quando um motorista não tem telefone.
- **`scripts/setup_motorista_teste.sql`** — prepara o motorista de teste.

### Base de dados

O motorista de teste (`alberdaniosilva16@gmail.com`) ficou com telefone e **online** em Belas.

Verificado:

```
get_cascade_drivers(-8.9333, 13.1833, 12, 5)
→ dánio | phone=+244938776308 | dist=0m | timeout=8s
```

Antes desta correcção esta mesma chamada devolvia o **email** na coluna `phone`.

### Segurança (mantida do hardening anterior)

| Pedido | Resultado |
|---|---|
| `GET` com token errado | **403** |
| `POST` sem autenticação | **401** |
| `POST` com chave `anon` | **401** |
| `POST` com assinatura Meta forjada | **401** |

---

## 3. O que preciso de ti para fechar isto

1. **App Secret** da app Meta — para eu assinar payloads de teste e provar o fluxo inteiro
   sem depender de a Meta entregar mensagens.
2. **Access token** — os secrets no Supabase só se vêem por *digest*, por isso não consigo
   confirmar se o token ainda está vivo. É o suspeito nº 1 de "parou de funcionar".
3. **Phone Number ID** — para confirmar que o que está no secret é o número certo.
4. **Confirmar o número do motorista de teste** — pus `+244938776308`, que é o que já estava
   no perfil de administrador (`alberdaniosilva15@gmail.com`). Se estiver errado, diz e eu mudo.
5. **Apontar o webhook da Meta** para:
   ```
   https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/whatsapp-webhook
   ```
   com o *verify token* que está no secret `WA_VERIFY_TOKEN`.

   ⚠️ Isto **substitui** o endereço antigo do n8n (`.../webhook/whatsapp-dani-o-msg`).

---

## 4. Como testar

### Passo 1 — pedir a corrida

Do WhatsApp do **passageiro**, enviar a **localização** (📎 → Localização).

**Esperado:** o bot responde com o endereço que reconheceu e pergunta *"Para onde queres ir?"*

> Também funciona escrever *corrida*, *táxi*, *chamar moto*.

### Passo 2 — dar o destino

Escrever o destino (ex.: `Talatona`) ou mandar outra localização.

**Esperado:** resumo com origem, destino, distância, tempo e **preço em Kz**, mais
*"Responde 1 para confirmar ou 2 para cancelar."*

### Passo 3 — confirmar

Responder `1`.

**Esperado:** *"Corrida confirmada! ... Código da viagem: XXXXXXXX"*

### Passo 4 — o motorista recebe

No WhatsApp do **motorista** (`+244938776308`) deve chegar:

```
🚗 Nova corrida Zenith Ride
Olá dánio, tens uma corrida perto de ti!

📍 Origem: ...
🏁 Destino: ...
💰 Valor: ... Kz
📏 Distância: ... km
🛣️ A ... km de ti

Responde ACEITAR XXXXXXXX para ficar com a viagem.
```

### Passo 5 — o motorista aceita

Responder `ACEITAR XXXXXXXX`.

**Esperado:**
- O **motorista** recebe a confirmação com os dados da recolha.
- O **passageiro** recebe o nome, telefone e avaliação do motorista.

---

## 5. De onde vem o preço — não há fórmula fixa no bot

O bot **não tem nenhuma fórmula de preço dentro dele**. Era isso que estava errado antes: eu
tinha copiado constantes do `calculate-price` (base 500 / 250 por km / mínimo 800) que não têm
nada a ver com o que o sistema usa.

Agora o preço sai sempre da base de dados, pela mesma ordem de prioridade que o app usa em
`PassengerHome.handleConfirmDriver`:

| Ordem | Fonte | Quando |
|---|---|---|
| 1 | `zone_prices` | Zonas de origem e destino detectadas nos endereços e **diferentes** — preço fixo por par de zonas |
| 2 | `calculate_fare_engine_pro` | Todo o resto — lê `pricing_config` (base, Kz/km, Kz/min, surge, pesos de zona, taxas) |

A detecção de zona usa o mesmo mapa do app (`LUANDA_ZONE_MAP`), com a regra da **palavra-chave
mais longa primeiro** — para *Benfica Sul* dar **Talatona** e não *Benfica*.

### Exemplos reais (verificados contra a base de dados)

| Viagem | Zonas detectadas | Fonte | Preço |
|---|---|---|---|
| Belas → Centro (18,6 km reais) | Talatona → Centro | preço fixo de zona | **3 150 Kz** |
| Belas → Kilamba (22 km) | Talatona → Kilamba | preço fixo de zona | **1 350 Kz** |
| Belas → Centro **sem** par de zonas | — | motor (`pricing_config`) | 5 200 Kz |

Ou seja: **quando existe preço fixo para o par de zonas, ele ganha** — exactamente como no app.

### Alterações do admin chegam ao bot sozinhas

O motor lê `pricing_config` a cada pedido. Não há cache nem valores guardados no código: mudar
a tarifa base, o Kz/km, o surge ou os pesos de zona **muda o preço do bot no pedido seguinte,
sem deploy**.

E o painel de admin já está ligado a essa tabela: na tab **Configurar** do painel, os sliders
lêem a linha activa de `pricing_config` e o botão **"Guardar preços"** escreve-a de volta. O que
o admin mexer ali é exactamente o que o bot passa a cobrar.

### O painel de admin manda nos preços (já ligado)

- Tab **Configurar** → grava em `pricing_config`, que é de onde o motor lê.
- Tab **Zonas fixas** → edita as 35 tarifas de `zone_prices`, com o preço da fórmula ao lado e um
  botão "usar fórmula" por linha. Lembra-te: **as tarifas fixas ganham ao motor** quando existe
  um par de zonas.

### Três coisas a saber (honestidade)

1. **34 das 35 tarifas fixas estão abaixo do preço da fórmula**, entre −15% e −42%. Exemplo:
   Maianga → Miramar, 1 km, está a 350 Kz quando a fórmula dá 600 Kz. Como as tarifas fixas têm
   prioridade, é isso que o passageiro paga. Na tab **Zonas fixas** vês o desvio em cada linha e
   podes alinhar tudo com um clique — mas é decisão tua, não mexi em nenhum preço.
2. **O surge fica em 1,5x.** O motor calcula `surge = min(1 + 0,5 × (procura ÷ oferta), 2,5)`.
   O app envia procura 5 / oferta 5 quando ainda não contou motoristas, o que dá 1,5x. O bot
   envia os mesmos 5/5 para o preço bater certo com o app. Quando quiseres, ligo o bot à
   contagem real de motoristas por perto.
3. **Desconto por score não se aplica no WhatsApp.** O app dá 1% / 3% / 5% conforme o score do
   passageiro, depois do motor. O bot não faz isto porque a conta do passageiro só é criada no
   momento de confirmar, já depois de o preço ter sido cotado.

---

## 6. Se alguma coisa falhar

| Sintoma | Onde olhar |
|---|---|
| O bot não responde nada | O webhook da Meta não está apontado para o Supabase, ou o token expirou |
| *"Não há motoristas disponíveis"* | O motorista de teste não está `available`, ou está a mais de 12 km da tua localização |
| O bot não reconhece o sítio | Geocodificação — tenta um nome mais específico (*Golfe Cidade Alta* em vez de *Golfe*) |
| *"Não consegui calcular o preço agora"* | O motor de preço não respondeu. A origem fica guardada; reenvia o destino |
| O motorista não recebe nada | `profiles.phone` do motorista, ou o número não está na lista de destinatários permitidos da conta de teste |

---

## 7. Duas notas honestas

**H3 não está a ser usado (ainda).** Disseste que querias o H3 para escolher o motorista mais
viável. Não há extensão `h3` no Postgres — só as colunas `h3_index_res9` / `h3_index_res7`,
que são preenchidas pelo cliente. O `find_drivers_h3` exige os índices já calculados. Usei
pesquisa por raio (PostGIS, 5 → 7 → 12 km), que é o que o H3 aproximaria. Para H3 a sério há
dois caminhos: activar a extensão no painel do Supabase, ou usar `h3-js` dentro da Edge
Function. Diz qual preferes.

**Não consegui provar que a Graph API v19.0 estava obsoleta.** Testei v19.0, v21.0 e v22.0 com
um token inválido e as três devolvem o mesmo erro de token — ou seja, o endpoint responde.
Mudei para v22.0 por coerência com as outras funções, não porque a v19.0 estivesse morta.
