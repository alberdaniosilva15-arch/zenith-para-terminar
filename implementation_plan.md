# Zenith Ride — Plano de Correcções Production-Ready

## O que vai ser corrigido

Análise completa do código real revelou **10 problemas** — alguns já existem parcialmente, outros precisam ser criados do zero.

---

## Diagnóstico Real (após análise do código)

| # | Problema | Estado Real | Acção |
|---|---------|-------------|-------|
| 1 | Pasta `{lib,contexts,hooks,services,components}` | ✅ É uma pasta vazia e inútil — não afecta imports | **Apagar** |
| 2 | Sem Zustand (estado global fragmentado) | ⚠️ Existe `useRide` hook + AuthContext mas sem store global | **Criar store Zustand** |
| 3 | RLS fraco | ⚠️ Existe mas a policy `rides: actualiza` permite ao motorista alterar corridas sem estar atribuído | **Corrigir SQL** |
| 4 | Ciclo de vida incompleto | ✅ Implementado (IDLE→BROWSING→ACCEPTED→PICKING_UP→IN_PROGRESS→COMPLETED) | **Verificar e documentar** |
| 5 | Tracking sem tempo real | ⚠️ `subscribeToDriverLocation` existe mas o parsing WKB pode falhar silenciosamente | **Adicionar fallback + logs** |
| 6 | Matching incompleto | ✅ Haversine existe em mapService + PostGIS no Supabase | **Sem alterações** |
| 7 | Componentes gigantes | 🔴 `PassengerHome.tsx` = 650 linhas, mistura UI + lógica | **Dividir em sub-componentes** |
| 8 | Tratamento de erros fraco | 🔴 Vários `await` sem try/catch, erros do Supabase descartados silenciosamente | **Adicionar error boundaries + toast** |
| 9 | Segurança frontend | ✅ API keys nunca no frontend (Gemini usa proxy, Supabase usa anon key) | **Manter** |
| 10 | Mapa sem integração completa | ⚠️ Map3D existe mas motorista não aparece com posição real durante corrida activa | **Corrigir subscribeToDriverLocation** |

---

## Proposed Changes

### 🗂️ Estrutura

#### [DELETE] `src/{lib,contexts,hooks,services,components}/`
Pasta vazia com nome literal — apagar com PowerShell.

---

### 📦 Estado Global — Zustand

#### [NEW] `src/store/useAppStore.ts`
Store Zustand com 3 slices: Auth, Ride, DriverTracking.

#### [MODIFY] `package.json`
Adicionar `zustand` às dependências.

---

### 🔐 Segurança — RLS

#### [NEW] `supabase/rls_fixes.sql`
- Corrigir policy `rides: actualiza` para exigir `driver_id = auth.uid()` nas transições de estado críticas
- Adicionar policy `rides: motorista pode ver corridas em searching` explicitamente separada
- Adicionar `WITH CHECK` em falta

---

### 🛡️ Tratamento de Erros

#### [NEW] `src/components/ErrorBoundary.tsx`
React Error Boundary global para capturar erros de renderização.

#### [NEW] `src/hooks/useToast.ts`
Sistema de notificações simples (toast) para erros de rede e acções.

#### [MODIFY] `src/services/rideService.ts`
- Adicionar try/catch em todos os `await` que não têm
- Melhorar `subscribeToDriverLocation` com fallback quando WKB falha
- Adicionar log de erros estruturado

---

### 🔄 Tracking em Tempo Real

#### [MODIFY] `src/services/rideService.ts`
- `subscribeToDriverLocation`: adicionar fallback lat/lng directo para casos onde WKB falha
- `updateDriverLocation`: adicionar retry em caso de erro de rede

---

### 🗺️ Mapa — Integração Completa

#### [MODIFY] `src/components/Map3D.tsx`
- Garantir que o pin do motorista aparece e move-se correctamente
- Corrigir leitura de `carLocation` quando vem do Realtime

---

### 🧩 Componentes — Divisão

#### [MODIFY] `src/components/PassengerHome.tsx`
Extrair sub-componentes para ficheiros separados:

#### [NEW] `src/components/passenger/SearchPanel.tsx`
Lógica de pesquisa pickup/destino.

#### [NEW] `src/components/passenger/RideStatusCard.tsx`
Cards de estado: SEARCHING, ACCEPTED, IN_PROGRESS.

#### [NEW] `src/components/passenger/DriverAuctionList.tsx`
Lista de motoristas do leilão.

---

### ⚡ Vite — Path Aliases

#### [MODIFY] `vite.config.ts`
Adicionar alias `@/` para `src/` para imports limpos.

#### [MODIFY] `tsconfig.json`
Adicionar `paths` correspondente.

---

## Verification Plan

### Automated
```bash
npm run build   # Verificar que compila sem erros
npm run lint    # Verificar que não há warnings novos
```

### Manual
- Testar fluxo completo: Login → Taxi → Escolher motorista → Corrida → Completar
- Verificar que mapa actualiza posição do motorista
- Verificar que erros de rede mostram mensagem ao utilizador

---

> [!IMPORTANT]
> **Ordem de execução**: 1) Apagar pasta inválida → 2) Instalar Zustand → 3) Criar store → 4) Corrigir rideService → 5) Dividir PassengerHome → 6) Corrigir RLS → 7) Verificar build

> [!NOTE]
> O código existente de `rideService.ts`, `useRide.ts`, e `AuthContext.tsx` está bem estruturado. As correcções são cirúrgicas — não é uma reescrita.
