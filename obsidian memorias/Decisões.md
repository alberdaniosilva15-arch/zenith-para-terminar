# Log de Decisões Técnicas

> Ver também: [[Skills]], [[Bugs-Resolvidos]], [[Arquitetura]]

## 2026-05-04: Auditoria Completa v3.1
- **Decisão**: Realizar revisão exaustiva de todo o codebase e criar sistema de memória Obsidian.
- **Racional**: Após múltiplas sessões de desenvolvimento, erros silenciosos acumularam-se. A criação de um sistema de memória garante que padrões e bugs aprendidos não se repetem.
- **Resultado**: 2 bugs críticos, 10 moderados, 4 menores encontrados. Sistema de Skills criado.

## 2026-05-04: Execução Bloco 1 e 2
- **Decisão**: Substituir toast local por Zustand, usar useRef invés de let em hooks (useRide), redirecionar logs do sendBeacon para Edge Function/Supabase e garantir timeout em module-level variables (autoRepairInProgress).
- **Racional**: Garantir performance livre de race conditions e logs consistentes sem dependência de APIs inexistentes.
- **Resultado**: Bugs sanados com sucesso e compilando sem erros.

## 2026-05-04: Planeamento Bloco 4 — Evolução JARVIS do Kaze CRM
- **Decisão**: Expandir o Kaze Agent de 4 para 8 tools, adicionar typing effect, error recovery inteligente, UI premium JARVIS (orbe com scan arcs, corner brackets, waveform), e auto-save de memória.
- **Racional**: O código Python do desktop revelou padrões avançados (19 tools, error handler, planner/executor) que podem ser adaptados ao CRM web para dar ao admin controlo total sem sair do chat.
- **Sub-blocos**: 4A (novas tools), 4B (error recovery), 4C (typing + kazeVoice), 4D (UI JARVIS), 4E (auto-save memória).
- **Segurança**: Whitelist de tabelas no `query_database`, confirmação manual em `ban_user`, replay protection via `request_id`.
- **Estado**: ✅ Executado e verificado com `tsc --noEmit` (0 erros).

## 2026-05-05: Execução Bloco 5 — Revenue, Segurança e Multi-Stop
- **Decisão**: Implementar sistema nativo de SMS de emergência (Capacitor), detecção de gritos (Web Audio API), partilha de emergência por Supabase Realtime, Contratos Premium com Zenith Pass, e pedido de multi-stop.
- **Racional**: Maximizar receita através de assinaturas e fee extra por paragens múltiplas, e elevar a segurança noturna (18h-4h) para protecção de motoristas sem depender de apps externas (WhatsApp).
- **Estado**: ✅ Código integralmente implementado e sem erros de compilação. Falta apenas aplicar a schema sql.## 2026-05-04: Sistema de Aprendizagem Obsidian
- **Decisão**: Criar ficheiros `Skills.md`, `Bugs-Resolvidos.md` e `Mapa-Ficheiros.md`.
- **Racional**: Sem memória persistente, os mesmos erros repetem-se. Com Skills, cada revisão melhora a próxima.
- **Regras criadas**: 6 padrões (P1-P6), 3 ferramentas (T1-T3), 1 checklist de revisão.

## 2026-05-03: Implementação de Limites de Tokens
- **Decisão**: Restringir Lukéni Bot a 40 tokens.
- **Racional**: Economia de custos, rapidez de resposta e foco operacional. Evitar que o bot seja usado para "chat geral".

## 2026-05-03: Redirecionamento Atómico de Corridas
- **Decisão**: Bypass da IA do n8n para o Webhook do Supabase ao detectar intenção de corrida.
- **Racional**: Eliminar latência e inconsistência da IA no processo crítico de dispatch de motoristas.

## 2026-05-03: Consolidação de Memória no Kaze
- **Decisão**: Implementar resumo automático de sessões e decay de 90 dias.
- **Racional**: Manter a performance do agente sem sobrecarregar o contexto com dados irrelevantes ou obsoletos.

## 2026-04-30: Remoção do Zustand Persist
- **Decisão**: Remover middleware `persist` do Zustand store (v3.5).
- **Racional**: O `partialize` retornava `{}`, causando overhead de serialização sem benefício. Ride state é sempre refrescado de `getActiveRide()`.
