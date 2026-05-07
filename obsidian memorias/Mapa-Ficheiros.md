# Mapa de Ficheiros — Zenith Ride v3.1

> Última actualização: 2026-05-04
> Ver também: [[Arquitetura]], [[BD]], [[Skills]]

## Estrutura Principal

### `/src/` — Código-fonte React

| Ficheiro | Responsabilidade | Notas |
|----------|-----------------|-------|
| `App.tsx` | Routing principal, ProtectedRoute, SessionReset | Lazy loading de Login, AuthenticatedApp |
| `main.tsx` | Entry point, ErrorBoundary, splash screen | Remove splash via RAF |
| `index.css` | Design system Imperial Black & Gold | Variáveis CSS globais |
| `types.ts` | Todos os tipos TypeScript (592 linhas) | Enums: UserRole, RideStatus, DriverStatus |

### `/src/contexts/`

| Ficheiro | Responsabilidade | Notas |
|----------|-----------------|-------|
| `AuthContext.tsx` | Sessão, auth, auto-repair, role resolution | 771 linhas. Retry com backoff exponencial |

### `/src/store/`

| Ficheiro | Responsabilidade | Notas |
|----------|-----------------|-------|
| `useAppStore.ts` | Zustand: Auth + Ride + DriverTracking + Toast | Sem persist (removido v3.5) |

### `/src/hooks/`

| Ficheiro | Responsabilidade | Notas |
|----------|-----------------|-------|
| `useRide.ts` | Lógica completa de corridas (525 linhas) | ⚠️ Bug M1: let + useCallback |
| `useNearbyDrivers.ts` | Lista de motoristas próximos | |
| `usePassengerGPS.ts` | GPS do passageiro com throttle | |
| `useSilentTripleTap.ts` | Panic button discreto (3 toques) | |
| `useIdleMount.ts` | Executar callback quando componente está idle | |

### `/src/services/`

| Ficheiro | Linhas | Responsabilidade |
|----------|--------|-----------------|
| `rideService.ts` | 1267 | Core: CRUD corridas, H3, realtime, GPS | ⚠️ Bug C2 |
| `mapService.ts` | 472 | Geocoding Mapbox, rota, locais estáticos Luanda |
| `geminiService.ts` | 461 | IA Kaze: chat, voz, fallback local |
| `premiumService.ts` | 482 | Serviços premium: charter, cargo, driver privado |
| `zonePrice.ts` | 266 | Preços fixos por zona, score discount |
| `pdfService.ts` | ~400 | Geração de PDFs (contratos, recibos) |
| `referralService.ts` | ~90 | Sistema de referrals |
| `gpsService.ts` | ~65 | Wrapper GPS nativo |
| `routeService.ts` | ~90 | Routing helpers |
| `mapboxRoutingService.ts` | ~45 | Mapbox Directions API |

### `/src/lib/`

| Ficheiro | Responsabilidade | Notas |
|----------|-----------------|-------|
| `supabase.ts` | Cliente Supabase singleton | URL + anon key via env |
| `logger.ts` | Logging estruturado + beacon | ⚠️ Bug M2: endpoint inexistente |
| `kazeVoice.ts` | TTS: ElevenLabs + Web Speech API | |
| `authUtils.ts` | Detecção de recovery/signup URLs | |
| `geo.ts` | Haversine (km + metros) | |
| `mapInstance.ts` | Instância Mapbox GL JS | |
| `driverTracker.ts` | Tracking GPS do motorista | |
| `driverMarker.ts` | Marcadores de mapa customizados | |
| `mapbox-directions.ts` | Directions API helper | |

### `/src/components/` (38 ficheiros + 4 subdirs)

| Componente | Descrição | Tamanho |
|-----------|-----------|---------|
| `PassengerHome.tsx` | Ecrã principal do passageiro | 28KB |
| `DriverHome.tsx` | Ecrã principal do motorista | 36KB |
| `AdminDashboard.tsx` | Painel administrativo | 41KB |
| `Login.tsx` | Login/Signup com Google OAuth | 20KB |
| `Wallet.tsx` | Carteira + Multicaixa + ZenithPay | 25KB |
| `Contract.tsx` | Gestão de contratos (escolar/trabalho) | 26KB |
| `LocationSearchPanel.tsx` | Pesquisa de destino com autocomplete | 23KB |
| `KazeMascot.tsx` | Mascote IA Kaze com chat | 16KB |
| `RideTalk.tsx` | Rádio de motoristas por zona | 18KB |

### `/supabase/functions/` (14 Edge Functions)

| Função | Propósito |
|--------|-----------|
| `gemini-proxy` | Proxy seguro para Gemini API |
| `calculate-price` | Cálculo de preço server-side |
| `match-driver` | Matching de motoristas |
| `multicaixa-pay` | Pagamentos Multicaixa Express |
| `whatsapp-webhook` | Webhook WhatsApp (Lukéni Bot) |
| `admin-ai-proxy` | Proxy IA para admin (Sentinel) |
| `admin-gate` | Autenticação admin |
| `agora-token` | Tokens para VoIP Agora |
| `analyze-patterns` | Análise de padrões de fraude |
| `dispatch-cascade` | Cascata de dispatch de motoristas |
| `kaze` | Edge function do Kaze |
| `safety-watchdog` | Vigilante de segurança (corridas 4h+) |
| `sentinel-vision` | Visão do Sentinel AI |
