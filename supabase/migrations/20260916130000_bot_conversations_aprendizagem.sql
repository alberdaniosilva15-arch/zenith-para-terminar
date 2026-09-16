-- ═══════════════════════════════════════════════════════════════════════════
-- bot_conversations — suporte ao fluxo de aprendizagem de locais
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O bot precisa de guardar, entre mensagens, o contexto de um local que não
-- conhece: qual dos dois extremos da corrida estava a ser resolvido, o texto
-- que o utilizador escreveu, e o nome corrigido que ele deu a seguir.
--
-- Sem isto o fluxo de aprendizagem não tem onde persistir o estado — a tabela
-- só tinha os campos da corrida.
--
-- Idempotente.

BEGIN;

ALTER TABLE public.bot_conversations
  ADD COLUMN IF NOT EXISTS aprendendo_slot  text,
  ADD COLUMN IF NOT EXISTS aprendendo_texto text,
  ADD COLUMN IF NOT EXISTS aprendendo_nome  text;

COMMENT ON COLUMN public.bot_conversations.aprendendo_slot  IS 'Extremo da corrida a resolver: origem | destino';
COMMENT ON COLUMN public.bot_conversations.aprendendo_texto IS 'Texto que o utilizador escreveu e que o bot não reconheceu';
COMMENT ON COLUMN public.bot_conversations.aprendendo_nome  IS 'Nome corrigido dado pelo utilizador para o local desconhecido';

-- ── Alargar o CHECK de `state` com os dois estados de aprendizagem ─────────
-- (DROP + ADD, para ser idempotente e para não depender do nome gerado)
ALTER TABLE public.bot_conversations
  DROP CONSTRAINT IF EXISTS bot_conversations_state_check;

ALTER TABLE public.bot_conversations
  ADD CONSTRAINT bot_conversations_state_check
  CHECK (state = ANY (ARRAY[
    'idle'::text,
    'awaiting_origin'::text,
    'awaiting_dest'::text,
    'awaiting_confirm'::text,
    'dispatching'::text,
    'in_ride'::text,
    'completed'::text,
    'aprendendo_nome'::text,
    'aprendendo_pin'::text
  ]));

-- ── `aprendendo_slot` só pode ter um dos dois valores ─────────────────────
ALTER TABLE public.bot_conversations
  DROP CONSTRAINT IF EXISTS bot_conversations_aprendendo_slot_check;

ALTER TABLE public.bot_conversations
  ADD CONSTRAINT bot_conversations_aprendendo_slot_check
  CHECK (aprendendo_slot IS NULL OR aprendendo_slot IN ('origem'::text, 'destino'::text));

COMMIT;
