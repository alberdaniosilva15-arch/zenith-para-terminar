# Zenith Ride — Deploy Completo · MFUMU Edition

## Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Supabase (PostgreSQL + Realtime + Auth + Edge Functions)
- **IA**: Google Gemini (via Edge Function gemini-proxy) — Kaze · Lukeni
- **Mapas**: Mapbox GL JS (mapa 3D de Luanda)
- **VoIP**: Agora.io SDK (chamadas em corrida)
- **Pagamentos**: Multicaixa Express (carregamentos e levantamentos)

---

## Ordem obrigatória de deploy

```
1. schema.sql              → base de dados principal
2. schema_additions.sql    → geocoding, leilão, funções SQL
3. migration_v3_features.sql → v3: contratos, bónus 70km, zona preços, escolar
4. Secrets no Supabase
5. Edge Functions deploy
6. .env preenchido
7. npm install && npm run build && npm run preview
```

---

## 1. Base de dados (Supabase → SQL Editor)

Executar em ordem:

```sql
-- 1.
schema.sql

-- 2.
schema_additions.sql

-- 3. (inclui: contracts, route_deviation_alerts, trigger 70km bónus)
migration_v3_features.sql
```

---

## 2. Secrets (Supabase → Settings → Edge Functions → Secrets)

```
GEMINI_API_KEY            = (Google AI Studio → API Keys)
SUPABASE_SERVICE_ROLE_KEY = (Supabase → Settings → API → service_role)
AGORA_APP_ID              = (Agora Console → Projects → App ID)
AGORA_APP_CERT            = (Agora Console → Projects → App Certificate)
MULTICAIXA_API_KEY        = (Multicaixa Express → Portal Merchant)
MULTICAIXA_MERCHANT_ID    = (Multicaixa Express → Portal Merchant)
MULTICAIXA_BASE_URL       = https://api-sandbox.multicaixaexpress.ao/v1
```

---

## 3. Edge Functions

```bash
supabase functions deploy agora-token      --no-verify-jwt
supabase functions deploy gemini-proxy     --no-verify-jwt
supabase functions deploy calculate-price
supabase functions deploy match-driver
supabase functions deploy multicaixa-pay
```

Localização: `supabase/functions/<nome>/index.ts`

---

## 4. Variáveis de ambiente (.env)

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-public-key>
VITE_MAPBOX_TOKEN=<mapbox-public-token>
VITE_GOOGLE_MAPS_KEY=<google-maps-browser-key>   # geocoding + search
```

---

## 5. Instalar e correr

```bash
npm install
npm run dev       # desenvolvimento
npm run build     # produção (gera /dist)
npm run preview   # pré-visualização do build
```

Abre `http://localhost:5173`

---

## Funcionalidades implementadas

| Módulo | Estado |
|--------|--------|
| Autenticação Supabase (email + role) | ✅ |
| Login Zenith Vantablack & Gold | ✅ |
| PassengerHome — mapa + pedido de corrida | ✅ |
| Leilão de motoristas (passageiro escolhe) | ✅ |
| DriverHome — corridas disponíveis + toggle online | ✅ |
| GPS tracking em tempo real (Mapbox + Supabase Realtime) | ✅ |
| RideTalk — chat passageiro ↔ motorista | ✅ |
| Chamadas VoIP em corrida (Agora.io) | ✅ |
| Kaze · Lukeni IA — chat, voz, insights, pós-corrida | ✅ |
| Carteira — saldo, transacções, top-up Multicaixa | ✅ |
| Contratos Escolares — agendamento + pais | ✅ |
| Contratos Familiares | ✅ |
| Contratos Empresariais | ✅ |
| Monitorização parental em tempo real | ✅ |
| Link de rastreamento para pais (sem conta) | ✅ |
| Desvio de rota — alerta automático | ✅ |
| Bónus 70km → 5km grátis (trigger PostgreSQL) | ✅ |
| FreePerk banner com celebração | ✅ |
| MotoGo Score (0-1000) + parceiros bancários | ✅ |
| Zona de preços fixos (sem surge) | ✅ |
| Kaze Preditivo — rotas frequentes | ✅ |
| Social Feed — RideTalks da comunidade | ✅ |
| Histórico de corridas paginado | ✅ |
| Admin Dashboard — Vigilante Engine | ✅ |
| Avaliação pós-corrida (Kaze guia) | ✅ |
| Modo poupança de dados | ✅ |
| Persistência offline (localStorage) | ✅ |
| Design Zenith — 0 violações de cor | ✅ |
