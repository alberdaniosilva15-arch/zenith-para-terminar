# 🔒 Kaze Core + Hermes — Ficheiros Protegidos

> **Data:** 2026-05-07
> **Contexto:** Auditoria completa do plano de hardening Kaze Core + Hermes + Safety do App.
> **Regra:** NÃO TOCAR nestes ficheiros salvo mudança extrema justificada.

---

## Estado: ✅ AUDITADO E CONFORME

Todos os 18 bugs/features do plano estão implementados e verificados no código.
O build passa sem erros. O kaze-agent arranca sem crash.

---

## Backend — Kaze Agent (`kaze-agent/`)

### 🔴 Críticos (Segurança já corrigida)

| Ficheiro | O que está protegido | Bug corrigido |
|----------|----------------------|---------------|
| `start.js` | CORS restrito a localhost, token seguro (.kaze-token), rate limiting 20/min, rotas Hermes, loopback-only | A4, A5, A9 |
| `agent.js` | Router inteligente LLM, fallback modelos, bridge Hermes, `confirmed=true` passado correctamente, schemas de validação | A15 |
| `security/permissions.js` | Audit log JSONL diário com append-only e masking de dados sensíveis | A14 |
| `security/executionPolicy.js` | Políticas para email (5/sessão), music (sempre), hermes (validação), file operations | A10 |
| `tools/networkTool.js` | ALLOWED_DOMAINS preenchido com localhost + Supabase URL | A8 |

### 🔵 Novos (Hermes Integration)

| Ficheiro | Função |
|----------|--------|
| `services/hermesService.js` | Cliente HTTP para Hermes, auto-start como child process, ping/health, execute, listSkills |
| `services/hermesBridge.js` | Ponte HTTP loopback em :4000, executa Hermes via CLI Python, discovery de repo/skills, fila de execução |
| `services/hermesRunner.py` | Wrapper Python que gere TLS fallback e invoca o Hermes real |
| `core/autoOperator.js` | Loop multi-step planeia→executa→observa, limite 10 iterações |

---

## Frontend — App Principal (`src/`)

### 🔴 Segurança e Safety

| Ficheiro | O que está protegido | Bug corrigido |
|----------|----------------------|---------------|
| `components/PanicButton.tsx` | SOS funciona sem emergencyPhone (persistPanic+broadcast), warning visual, feedback háptico no triple-tap silencioso | A1, A18 |
| `components/PassengerHome.tsx` | PanicButton só durante corrida activa, contacto de emergência obrigatório antes de pedir/agendar corrida | A11, A17 |
| `components/DriverHome.tsx` | ScreamDetection activa sempre com corrida (sem condição horária), triple-tap silencioso, contacto emergência exigido para ficar online | A2 |
| `components/passenger/ActiveRideCard.tsx` | Botão cancelar em ACCEPTED, botões 112/113 visíveis em ACCEPTED e IN_PROGRESS | A6, A16 |
| `components/NightSafetyBanner.tsx` | Reaparece por contexto de corrida, reset do dismissed, só visível durante corrida nocturna | A7 |
| `components/Profile.tsx` | Validação de telefone angolano (+244, 9 dígitos, começa com 9) | A12 |
| `components/KazePanel.jsx` | refreshSession() com fallback, await kazeSpeak(), status Hermes, painel multi-step, confirmação de críticas | A3, A13 |

### 🟢 Utilitários

| Ficheiro | Função |
|----------|--------|
| `lib/phone.ts` | `normalizeAngolanPhone()` e `isValidAngolanPhone()` |
| `hooks/useSilentTripleTap.ts` | Hook de 3 taps em 1.5s com cooldown 3s |

---

## Configuração

| Ficheiro | Notas |
|----------|-------|
| `.env.example` | Contém `HERMES_COMMAND`, `HERMES_ENTRY`, `HERMES_DIR` para configurar arranque do Hermes |
| `kaze-agent/.kaze-token` | Token único gerado por `crypto.randomBytes(32)` — NÃO commitar |

---

## ⚠️ Quando é seguro alterar

- **Só se** houver uma mudança de arquitectura fundamental (ex: migração de framework, mudança de modelo de segurança)
- **Nunca** reverter: remoção do token hardcoded, CORS restrito, rate limiting, validação de telefone
- **Cuidado** com: PanicButton (qualquer alteração pode quebrar o SOS), executionPolicy (pode desbloquear acções perigosas)

---

## Links rápidos

- [[Tools]] — ferramentas do kaze-agent
- [[Arquitetura]] — diagrama geral
- [[Decisões]] — histórico de decisões de design
