# Log de Bugs — Zenith Ride

> Registo cronológico de bugs encontrados e resolvidos.
> Ver também: [[Skills]], [[Decisões]]

---

## 2026-05-04: Auditoria Completa v3.1

### 🔴 Críticos
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| C1 | Chaves API no `.env` (GEMINI_API_KEY no frontend) | `.env` | ✅ Resolvido (Não exposto) |
| C2 | 5 labels de erro INCORRECTAS em catch blocks | `rideService.ts` | ✅ Resolvido |

### 🟡 Moderados
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| M1 | Race condition: `let` + `useCallback` no useRide | `useRide.ts` L69-70 | ✅ Resolvido |
| M2 | Logger sendBeacon para `/api/logs` inexistente | `logger.ts` L23 | ✅ Resolvido |
| M3 | ErrorBoundary não usa `logError()` | `ErrorBoundary.tsx` | ✅ Resolvido |
| M4 | `checkRouteDeviation` compara com destino, não rota | `rideService.ts` | ⏳ Pendente |
| M5 | Toast duplicado (local vs Zustand) na Wallet | `Wallet.tsx` | ✅ Resolvido |
| M6 | `opencode-windows-x64` em prod dependencies | `package.json` | ✅ Resolvido |
| M7 | `recharge_chat_quota` RPC — falha silenciosa | `rideService.ts` L727 | ✅ Resolvido |
| M8 | `Promise.resolve()` desnecessário em auto-repair | `AuthContext.tsx` L360 | ✅ Resolvido |
| M9 | `autoRepairInProgress` global sem safety timeout | `AuthContext.tsx` L34 | ✅ Resolvido |
| M10 | `setInterval` sem cleanup (rate limiter) | `rideService.ts` L110 | ⏳ Documentar |

### 🟢 Menores
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| N1 | Mixed line endings CRLF/LF | Vários | ⏳ |
| N2 | `as any` type assertions excessivos | Vários | ⏳ |
| N3 | Material Symbols sem import garantido | Componentes | ⏳ |
| N4 | `DbProfileV3` campos duplicados de `DbProfile` | `types.ts` L575 | ✅ Resolvido |

---

## 2026-05-07: Hardening Kaze Core + Hermes (18 Bugs/Features)

> Ver também: [[Kaze-Core-Hermes-Protegido]]

### 🔴 Críticos (Segurança)
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| A1 | PanicButton silenciosamente inútil sem emergencyPhone | `PanicButton.tsx` | ✅ Resolvido |
| A2 | ScreamDetection desligada durante o dia | `DriverHome.tsx` | ✅ Resolvido |
| A3 | KazePanel usa getSession() em vez de refreshSession() | `KazePanel.jsx` | ✅ Resolvido |
| A4 | CORS wildcard no Kaze Agent local | `start.js` | ✅ Resolvido |
| A5 | Token dev-kaze-token hardcoded aceite em runtime | `start.js` | ✅ Resolvido |

### 🟠 Funcionais
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| A6 | Sem botão cancelar no estado ACCEPTED | `ActiveRideCard.tsx` | ✅ Resolvido |
| A7 | NightSafetyBanner descartável sem consequências | `NightSafetyBanner.tsx` | ✅ Resolvido |
| A8 | Network tool com ALLOWED_DOMAINS vazio | `networkTool.js` | ✅ Resolvido |
| A9 | Sem rate-limiting no /command | `start.js` | ✅ Resolvido |
| A10 | Execution Policy sem política para email/music | `executionPolicy.js` | ✅ Resolvido |

### 🟡 UX e Erros Silenciosos
| ID | Bug | Ficheiro | Estado |
|----|-----|----------|--------|
| A11 | PanicButton fixo sempre visível | `PassengerHome.tsx` | ✅ Resolvido |
| A12 | Profile não valida formato de telefone | `Profile.tsx` + `phone.ts` | ✅ Resolvido |
| A13 | kazeSpeak() chamada sem await | `KazePanel.jsx` | ✅ Resolvido |
| A14 | Audit log cresce sem rotação no disco | `permissions.js` | ✅ Resolvido |
| A15 | writeFile/deleteFile nunca passam confirmed=true | `agent.js` | ✅ Resolvido |

### 🔵 Funcionalidades Novas
| ID | Feature | Ficheiro | Estado |
|----|---------|----------|--------|
| A16 | Botão 112/113 visível durante corrida | `ActiveRideCard.tsx` | ✅ Implementado |
| A17 | Forçar contacto de emergência antes da corrida | `PassengerHome.tsx` | ✅ Implementado |
| A18 | Feedback visual/háptico no triple-tap silencioso | `PanicButton.tsx` + `useSilentTripleTap.ts` | ✅ Implementado |

---

## Histórico Consolidado (resolvidos — detalhes omitidos para poupar tokens)
BUG#2 DriverName ✅ | BUG#5 setTimeout cleanup ✅ | BUG#6 effectiveUser morto ✅ | BUG#9 DbProfile ✅ | BUG#11 Gemini history format ✅
