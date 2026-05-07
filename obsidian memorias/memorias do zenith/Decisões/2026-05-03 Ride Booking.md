# Decisão: Ride Booking via WhatsApp

Data: 2026-05-03
Decisor: Admin

## Contexto
O whatsapp-webhook já implementa ride-booking completo.
O bot n8n processava tudo pela IA sem redirecionar.

## Decisão
Adicionar detector de corrida no n8n que redireciona para o webhook.
Bot foca em respostas curtas e FAQ. Webhook foca em ride-booking.

## Impacto
- Respostas mais rápidas (sem passar pela IA para corridas)
- Menor custo de tokens
- Fluxo atómico e fiável
