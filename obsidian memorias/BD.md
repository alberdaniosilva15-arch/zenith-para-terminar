# Esquema de Dados (Supabase)

> Ver também: [[Arquitetura]], [[Tools]], [[Mapa-Ficheiros]]

## Tabelas Principais
| Tabela | Propósito | RLS |
|--------|-----------|-----|
| `users` | Conta do utilizador (id, email, role, suspended_until) | ✅ |
| `profiles` | Perfil (nome, avatar, rating, level, km_total, chat_quota) | ✅ |
| `rides` | Corridas (origem, destino, preço, status, driver_confirmed) | ✅ |
| `driver_locations` | GPS em tempo real (PostGIS GIST + H3 indexes) | ✅ |
| `wallets` | Saldo financeiro por utilizador | ✅ |
| `transactions` | Histórico de transacções (ride_payment, top_up, etc.) | ✅ |
| `ratings` | Avaliações entre utilizadores | ✅ |
| `zone_prices` | Preços fixos por par de zonas | ✅ |
| `ride_tracking_shares` | Links de partilha live (tokens públicos) | ✅ |
| `route_deviation_alerts` | Alertas de desvio de rota | ✅ |
| `premium_bookings` | Reservas premium (driver privado, charter, cargo) | ✅ |
| `cargo_bookings` | Detalhes de carga (peso, helpers, urgência) | ✅ |
| `charter_bookings` | Detalhes de fretamento (capacidade, evento) | ✅ |
| `service_pricing` | Tabela de preços por tipo de serviço e cidade | ✅ |
| `demand_heatmap` | Mapa de calor de procura (H3 + window) | ✅ |
| `geocoding_cache` | Cache de geocoding (query → coords) | ✅ |
| `admin_knowledge` | Memória de longo prazo do Sentinel | ✅ |
| `ai_event_logs` | Auditoria completa de acções de IA | ✅ |
| `ai_usage_logs` | Rate limiting de IA | ✅ |
| `panic_alerts` | Alertas de pânico | ✅ |
| `contracts` | Contratos (escolar, trabalho) | ✅ |
| `posts` | Feed social | ✅ |

## Funções RPC Importantes
| RPC | Propósito |
|-----|-----------|
| `find_nearby_drivers` | Procura espacial PostGIS optimizada |
| `find_drivers_h3` | Procura por hexágonos H3 (mais rápida) |
| `find_drivers_for_auction` | Leilão de motoristas com scoring |
| `accept_ride_atomic` | Aceitar corrida com lock FOR UPDATE |
| `decline_ride_atomic` | Recusar corrida atomicamente |
| `cancel_ride_safe` | Cancelar corrida com validações |
| `create_selected_ride_atomic` | Criar corrida com motorista pré-seleccionado |
| `process_ride_payment_v3` | Pagamento atómico |
| `ensure_user_exists` | Auto-repair se trigger falhou |
| `set_my_role_*` | Mudar role (passenger/driver/fleet_owner) |
| `calculate_fare_engine_pro` | Cálculo de preço server-side |
| `recharge_chat_quota` | Recarregar créditos do Kaze |
| `ban_user_by_phone` | Gestão de segurança |
| `increment_geocode_hit` | Incrementar hits no cache |
| `get_active_ride` | Obter corrida activa do utilizador |

## Segurança (RLS)
- Utilizadores só acedem aos seus dados.
- Admins têm acesso via `is_admin()`.
- `driver_locations` — motoristas só actualizam a sua própria localização.
- `rides` — passageiros e motoristas só vêem as suas corridas.

## Triggers Importantes
- `handle_new_user` — Cria registos em `users` e `profiles` após signup.
