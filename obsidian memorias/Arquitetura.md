# Arquitetura do Ecossistema Zenith Ride v5.1

> Ver também: [[Mapa-Ficheiros]], [[BD]], [[Tools]], [[Prompts]]

## Componentes Principais
1. **Frontend React (Vite)**: SPA com React 18, Zustand, Mapbox GL JS, H3-js.
2. **Lukéni Bot (n8n)**: Orquestrador de IA para o WhatsApp. Gerencia o fluxo de entrada, classificação de intenções e redirecionamento de corridas.
3. **Kaze Admin CRM**: Painel de controlo SAAS para administradores. Integra o Sentinel AI para análise operacional.
4. **Supabase Backend**: Base de dados (PostgreSQL + PostGIS), Edge Functions (Typescript) e Realtime.
5. **Sentinel AI**: IA operacional baseada em Gemini 2.0 Pro, com capacidade de tool-calling para gestão de frota e auditoria.

## Stack Tecnológica
- **Frontend**: React 18 + TypeScript 6 + Vite 5 + Zustand 4
- **Mapas**: Mapbox GL JS v3 + H3-js v4 (hexágonos)
- **Backend**: Supabase (PostgreSQL 15 + PostGIS + Realtime)
- **IA**: Google Gemini 2.0 Flash (via Edge Function `gemini-proxy`)
- **VoIP**: Agora RTC SDK
- **Pagamentos**: Multicaixa Express (via Edge Function)
- **Deploy**: Vercel (frontend) + Supabase Cloud (backend)
- **Mobile**: Capacitor (Android)

## Fluxo de Dados
- **Utilizador** → **WhatsApp** → **n8n** → (IA ou Webhook Supabase) → **Utilizador**.
- **Admin** → **CRM** → **admin-ai-proxy** → **Sentinel AI** → **Base de Dados**.
- **Passageiro** → **App React** → **Supabase Realtime** → **Motorista**.

## Fluxo de uma Corrida
1. Passageiro define origem (GPS) e destino (autocomplete Mapbox)
2. Frontend calcula preço via `calculate_fare_engine_pro` RPC ou `zonePrice`
3. Passageiro vê lista de motoristas (H3 → PostGIS fallback)
4. Passageiro escolhe motorista → `create_selected_ride_atomic` RPC
5. Motorista recebe notificação via Realtime + WhatsApp fallback
6. Motorista confirma → status `picking_up`
7. GPS do motorista actualizado via Realtime channels
8. Corrida completa → pagamento atómico via `process_ride_payment_v3`

## Segurança
- JWT Validation em todas as Edge Functions.
- RLS (Row Level Security) estrito em todas as tabelas.
- Rate limiting persistente via `ai_usage_logs`.
- Panic button com gravação de áudio e alerta à polícia.
- Watchdog de corridas longas (4h+ → alerta automático).

## Ficheiros de Configuração
- `.env` — Variáveis de ambiente (NUNCA commitar)
- `vite.config.ts` — Build config com proxy e aliases
- `vercel.json` — Routing SPA + headers de segurança
- `capacitor.config.ts` — Config mobile Android
- `tailwind.config.js` — Design tokens
