# Ferramentas de IA (Sentinel/Kaze)

> Ver também: [[Prompts]], [[BD]], [[Decisões]]

---

## Tools Existentes (v2.0 — já implementadas)

### `query_metrics`
- **Capacidade**: Métricas pré-definidas (corridas_hoje, receita, motoristas_activos, rides_week).
- **Uso**: "Quantas corridas tivemos hoje?"
- **Backend**: `admin-ai-proxy` → queries directas ao Supabase com service_role.

### `manage_driver`
- **Capacidade**: Bloquear/desbloquear motorista via `driver_locations.status`.
- **Uso**: "Bloqueia o motorista X."
- **Segurança**: Requer aprovação no UI antes de executar.

### `view_bot_logs`
- **Capacidade**: Ver últimas N entradas de `ai_usage_logs` (conversas Lukéni).
- **Uso**: "Mostra as últimas 10 conversas do bot."

### `memory_manage`
- **Capacidade**: CRUD na tabela `admin_knowledge` (memória de longo prazo do Kaze).
- **Uso**: "Lembra-te que a taxa de comissão vai mudar no próximo mês."
- **Tabela**: `admin_knowledge` (key, value, updated_at).

---

## Tools Implementadas (v3.0 — Bloco 4 ✅ Concluído)

### `query_database` ✅ IMPLEMENTADO
- **Capacidade**: SELECT genérico em qualquer tabela autorizada com filtros, ordenação e limites.
- **Whitelist de tabelas**: rides, users, profiles, transactions, wallets, ratings, panic_alerts, contracts, zone_prices, demand_heatmap.
- **Segurança**: NUNCA expõe `auth.users` ou tabelas internas. Limite de 50 linhas. Usa service_role no backend.
- **Uso**: "Mostra-me as corridas canceladas desta semana com preço > 5000 Kz."
- **Parâmetros**: table, select, filters[{column, operator, value}], order_by, ascending, limit.

### `ban_user` ✅ IMPLEMENTADO
- **Capacidade**: Suspender utilizador via `users.suspended_until`.
- **Uso**: "Suspende o utilizador abc123 por fraude durante 30 dias."
- **Segurança**: Requer confirmação manual no CRM (tool_request → is_pending).
- **Parâmetros**: user_id, reason, duration_days (0 = permanente).

### `broadcast_message` ✅ IMPLEMENTADO (log-only, entrega real futura)
- **Capacidade**: Registar broadcast para motoristas/passageiros.
- **Estado actual**: Guarda em `admin_knowledge` como log. Entrega real via WhatsApp webhook (fase futura).
- **Uso**: "Avisa todos os motoristas online que há manutenção às 3h."
- **Parâmetros**: target (all_drivers/online_drivers/all_passengers), message.

### `save_memory` ✅ IMPLEMENTADO
- **Capacidade**: Auto-save proactivo de factos operacionais que o admin revela.
- **Diferença vs memory_manage**: O Kaze decide SOZINHO guardar sem perguntar.
- **Uso**: O admin diz "Vamos expandir para Benguela em Junho" → Kaze guarda automaticamente.
- **Parâmetros**: category (strategy/pricing/operations/personnel/technical), fact.
- **Instrução no system prompt**: "Se o admin revelar informação estratégica, guarda automaticamente."

---

## Arquitectura de Segurança das Tools

```
[Frontend CRM]
      │
      ├── askSentinel() → POST admin-ai-proxy (action: sentinel_chat)
      │                    ↓
      │               Gemini analisa → retorna tool_request
      │                    ↓
      ├── handleToolConfirm() → POST admin-ai-proxy (action: execute_tool)
      │                         ↓
      │                    Backend executa com service_role
      │                    Loga em ai_event_logs
      │                         ↓
      └── resultado mostrado no chat
```

- **JWT obrigatório** em todos os pedidos.
- **Role admin** verificado via tabela `users`.
- **Rate limit**: 100 req/hora por admin.
- **Replay protection**: `request_id` verificado em `ai_event_logs`.
- **Whitelist de tabelas** no `query_database`.
- **Confirmação manual** em tools destrutivas (ban_user, manage_driver).
