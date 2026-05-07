# Tabelas do Bot

## whatsapp_sessions
Máquina de estados para ride-booking via WhatsApp.
Estados: IDLE → AWAITING_ORIGIN → AWAITING_DEST → AWAITING_CONFIRM → RIDE_ACTIVE

## geocoding_cache
Cache de geocoding Mapbox para evitar chamadas repetidas.

## conversation_memory
Histórico de conversas por user_id.

## user_profiles
Perfis auto-detectados (nome, preferências, total de mensagens).

## message_dedup
Deduplicação de mensagens (24h TTL).
