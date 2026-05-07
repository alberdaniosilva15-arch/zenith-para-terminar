# Visão Geral da Arquitectura

## Stack
- Frontend: React + TypeScript + Vite (Imperial Black & Gold design)
- Backend: Supabase (PostgreSQL + Edge Functions + Realtime)
- Bot: n8n (Lukéni Bot v5.0) + WhatsApp Meta Cloud API
- IA: DeepSeek → Groq → Gemini → NVIDIA NIM → OpenRouter (cascade fallback)
- Admin: Kaze Agent (Node.js local + Edge Function)
- Maps: Mapbox (geocoding + reverse geocoding)
- Pagamentos: Multicaixa Express
- Voz: ElevenLabs TTS

## Fluxo Principal
1. Passageiro envia mensagem WhatsApp/Telegram
2. n8n recebe via trigger, classifica com orquestrador IA
3. Se é pedido de corrida → redireciona para whatsapp-webhook
4. whatsapp-webhook faz geocoding, calcula preço, pede confirmação
5. Passageiro confirma → cria ride na BD → dispatch-cascade notifica motoristas
6. Primeiro motorista aceita → notifica passageiro via WhatsApp
