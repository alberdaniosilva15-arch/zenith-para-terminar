# Skills & Aprendizagem — Zenith Ride

> Sistema de aprendizagem contínua. Padrões, armadilhas e regras aprendidas.
> Actualizado a cada revisão. Ver: [[Bugs-Resolvidos]], [[Decisões]]

---

## 🧠 Padrões Aprendidos

### P1. Catch blocks com labels — VERIFICAR SEMPRE
**Contexto**: Em `rideService.ts` encontrámos 5 labels de erro incorrectas. Quando se copia código de um catch para outro, a label fica da função original.
**Regra**: Ao criar/copiar um catch block, confirmar que `console.warn('[módulo.método]', ...)` corresponde à função actual.
**Gravidade**: Alta — em produção, logs com labels erradas tornam debugging impossível.

### P2. `let` + `useCallback` reassignment = race condition
**Contexto**: Em `useRide.ts`, `applyDbRide` e `subscribeToRide` eram declaradas como `let no-op` e reassigned via `useCallback`. O `useEffect` capturava a versão vazia.
**Regra**: Nunca declarar variáveis de função como `let` para reassignment posterior em React. Usar `useCallback` directamente ou `useRef` para referências mutáveis.

### P3. Toast systems — um só, global
**Contexto**: A `Wallet.tsx` tinha o seu próprio sistema de toast, separado do Zustand global.
**Regra**: Usar sempre o `showToast` do Zustand store. Componentes NÃO devem ter toast local.

### P4. Logger beacon — precisa de endpoint real
**Contexto**: `navigator.sendBeacon('/api/logs')` falha silenciosamente se não houver endpoint.
**Regra**: Antes de implementar sendBeacon, garantir que o endpoint existe. Em Vercel, criar API route. Em Supabase, criar Edge Function.

### P5. `Promise.resolve()` wrap desnecessário
**Contexto**: `Promise.resolve(supabase.rpc(...))` — o rpc() já retorna Promise.
**Regra**: Não envolver em `Promise.resolve()` chamadas que já são Promises.

### P6. Variáveis module-level em React modules
**Contexto**: `autoRepairInProgress` no AuthContext é module-level. Persiste entre hot-reloads.
**Regra**: Variáveis de lock module-level precisam de safety timeout (ex: 30s auto-reset) para evitar deadlocks em dev.

### P7. Error Recovery em tool-calling — reenviar erro ao LLM
**Contexto**: No Kaze CRM, quando uma tool falhava, o user via apenas "Erro na execução" sem contexto.
**Regra**: Quando uma tool falha, capturar o `err.message`, injectá-lo como prompt automático para o LLM analisar a causa e sugerir alternativa. Nunca deixar o utilizador sem informação.
**Inspiração**: O desktop Python tinha `error_handler.py` com decisão IA (retry/skip/replan/abort).

### P8. Typing effect — limpar timeout no cleanup
**Contexto**: O typing caracter-a-caracter usa `setTimeout` recursivo.
**Regra**: Sempre guardar o `timeoutId` num `useRef` e limpá-lo no return do `useEffect` e antes de iniciar novo typing. Caso contrário, múltiplos typings acumulam-se.

### P9. Whitelist de tabelas em query genérico
**Contexto**: O `query_database` permite SELECT em qualquer tabela.
**Regra**: SEMPRE usar whitelist no backend. Nunca confiar no input do frontend para nome de tabela. Limite de 50 rows máximo.

### P10. Limpeza de memórias Obsidian — apagar o obsoleto
**Contexto**: Memórias acumulam-se entre sessões. Informação "planeado" que já está feito ocupa tokens sem utilidade.
**Regra**: Ao actualizar o Obsidian após executar uma tarefa:
  1. Mudar todos os estados de "Planeado" / "⚡ NOVO" para "✅ Implementado".
  2. Consolidar bugs antigos já resolvidos numa secção "Histórico" resumida (1 linha por bug).
  3. Remover detalhes de decisões com mais de 30 dias se já não forem relevantes — manter apenas título + resultado.
  4. Nunca apagar padrões (P1-P9+) — são conhecimento permanente.

### P11. SMS Nativo e Chamadas via Capacitor
**Contexto**: O envio de SMS de emergência através de apps como o WhatsApp falha se o utilizador não tiver a app ou internet.
**Regra**: Para funcionalidades críticas de emergência (panic button), usar sempre integração nativa direta ao OS (ex: Android SMS Manager ou `window.location.href = 'tel:...'`) como primeira linha ou fallback garantido.

### P12. Monitorização de Áudio Contínua (Web Audio API)
**Contexto**: A deteção de gritos foi implementada com a Web Audio API acedendo ao microfone e medindo a amplitude (`AnalyserNode`).
**Regra**: Em loops contínuos de verificação de áudio (`requestAnimationFrame`), garantir que o array `dataArray[i]` é verificado para `undefined` para não rebentar a thread com *TypeErrors* (visto no `screamDetector.ts`).

---

## 🔧 Ferramentas & Técnicas

### T1. Verificação rápida de compilação
```bash
npx tsc --noEmit  # Zero errors = build seguro
```

### T2. Grep para labels de erro incorrectas
```bash
# Verificar se o nome no console.warn corresponde ao método
grep -n "console\.\(warn\|error\)" src/services/rideService.ts
```

### T3. Encontrar toast locais duplicados
```bash
grep -rn "useState.*toast\|setToast\|toastMsg" src/components/
```

### T4. Limpeza de memórias Obsidian (após cada bloco)
1. Rever `Bugs-Resolvidos.md` — mover resolvidos antigos para "Histórico" (1 linha).
2. Rever `Tools.md` — mudar "⚡ NOVO" para "✅ IMPLEMENTADO".
3. Rever `Decisões.md` — marcar "Estado: ✅ Executado".
4. Rever `Prompts.md` — marcar "Planeado" como "Activo" quando aplicável.
5. **Regra de ouro**: Nunca apagar *Padrões* (Skills), apenas consolidar *Dados* (bugs/decisões).

---

## 📊 Métricas do Projecto

| Métrica | Valor | Data |
|---------|-------|------|
| Ficheiros TypeScript | ~60 | 2026-05-04 |
| Linhas de código (src/) | ~15.000+ | 2026-05-04 |
| Edge Functions | 14 | 2026-05-04 |
| Bugs críticos resolvidos | 2/2 | 2026-05-04 |
| Bugs moderados resolvidos | 10/10 | 2026-05-04 |
| TypeScript errors | 0 | 2026-05-04 |
| Kaze Tools (admin) | 8 (✅ implementado) | 2026-05-04 |

---

## 🎯 Checklist de Revisão (usar em cada auditoria)

- [ ] `tsc --noEmit` — 0 erros
- [ ] Labels de catch blocks correctas
- [ ] Sem `let` + reassignment de callbacks React
- [ ] Toast system é global (Zustand), não local
- [ ] Logger aponta para endpoint real
- [ ] `.env` não commitado
- [ ] Chaves sensíveis só server-side
- [ ] `Promise.resolve()` não envolve Promises existentes
- [ ] ErrorBoundary usa `logError()`
- [ ] Sem `as any` desnecessários
