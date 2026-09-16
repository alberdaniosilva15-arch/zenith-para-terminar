-- ============================================================================
-- ZENITH RIDE — ai_usage_logs: acrescenta as colunas que o código já escreve
--
-- SINTOMA
--   Nenhuma falha de IA fica registada. Em particular, o Kaze ficou mudo e não
--   havia uma única linha de `get_live_token` em `ai_usage_logs` para explicar
--   porquê.
--
-- CAUSA
--   O `logAiUsage()` do `supabase/functions/gemini-proxy/index.ts` insere:
--     { user_id, action, tokens_used, estimated_cost, error_returned, created_at }
--   mas a tabela só tem:
--     { id, user_id, action, tokens_used, created_at }
--   O PostgREST rejeita o INSERT por causa das colunas desconhecidas. O erro é
--   apanhado pelo `try/catch` do próprio `logAiUsage`, que só faz
--   `console.warn` — por isso a gravação falhava em silêncio, sempre.
--
-- CORRECÇÃO
--   Acrescentar as duas colunas em falta. É aditivo: não altera nem apaga
--   nada, e as linhas antigas ficam com NULL. Assim o registo volta a
--   funcionar para todas as acções, não só para a voz.
--
-- NOTA
--   `error_returned` é precisamente o campo que guarda a mensagem de erro do
--   fornecedor. Sem ele, uma falha de voz é indistinguível de "o utilizador
--   não carregou no botão".
-- ============================================================================

ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS estimated_cost numeric,
  ADD COLUMN IF NOT EXISTS error_returned text;

COMMENT ON COLUMN public.ai_usage_logs.error_returned IS
  'Mensagem de erro devolvida pelo fornecedor de IA (NULL quando correu bem).';
COMMENT ON COLUMN public.ai_usage_logs.estimated_cost IS
  'Custo estimado da chamada, na unidade usada pelo fornecedor.';

-- Verificação: as duas colunas têm de aparecer.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ai_usage_logs'
  AND column_name IN ('estimated_cost', 'error_returned')
ORDER BY column_name;
