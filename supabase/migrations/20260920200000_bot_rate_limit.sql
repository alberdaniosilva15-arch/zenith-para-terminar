-- =============================================================================
-- ZENITH RIDE — limite de pedidos do bot (rate limit persistente)
-- =============================================================================
-- Data: 2026-09-20
--
-- PORQUE É QUE ISTO EXISTE
-- ─────────────────────────────────────────────────────────────────────────────
-- O Lukéni vai ganhar uma camada de conversa (Groq) para deixar de responder
-- com o manual de instruções a tudo o que não seja um pedido de corrida. Essa
-- camada custa dinheiro por chamada — logo tem de ter travão.
--
-- O travão vive no Postgres e não na memória da Edge Function por um motivo
-- simples: as Edge Functions são efémeras e correm em paralelo. Um contador em
-- memória não conta nada quando existem dez instâncias a atender o mesmo
-- telefone. Um contador numa linha da base conta sempre.
--
-- ⚠️ A contagem é por TELEFONE NORMALIZADO, não por IP. O IP é um sinal fraco
-- (redes móveis partilham IP entre milhares de pessoas) e um atacante muda de
-- IP trivialmente. O telefone é a identidade que o bot já usa para tudo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bot_rate_limits (
  telefone       TEXT PRIMARY KEY,
  janela_inicio  TIMESTAMPTZ NOT NULL DEFAULT now(),
  contagem       INTEGER     NOT NULL DEFAULT 0,
  dia            DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Luanda')::date,
  contagem_dia   INTEGER     NOT NULL DEFAULT 0,
  actualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bot_rate_limits IS
  'Contador de pedidos do bot por telefone. janela_inicio/contagem = janela de 1 minuto; dia/contagem_dia = tecto diario.';

CREATE INDEX IF NOT EXISTS idx_bot_rate_limits_actualizado
  ON public.bot_rate_limits (actualizado_em);

ALTER TABLE public.bot_rate_limits ENABLE ROW LEVEL SECURITY;

-- Ninguém lê isto pelo cliente. Só a Edge Function, com service_role.
DROP POLICY IF EXISTS "sem acesso publico" ON public.bot_rate_limits;

-- ── Verificação atómica ──────────────────────────────────────────────────────
-- Uma só instrução: incrementa E devolve o estado. Não há leitura-depois-escrita
-- (que seria uma corrida entre duas mensagens simultâneas do mesmo telefone).
CREATE OR REPLACE FUNCTION public.check_bot_rate_limit(
  p_telefone   TEXT,
  p_max_minuto INTEGER DEFAULT 5,
  p_max_dia    INTEGER DEFAULT 80
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_linha  public.bot_rate_limits;
  v_agora  TIMESTAMPTZ := now();
  v_dia    DATE := (now() AT TIME ZONE 'Africa/Luanda')::date;
  v_max_min INTEGER := GREATEST(COALESCE(p_max_minuto, 5), 1);
  v_max_dia INTEGER := GREATEST(COALESCE(p_max_dia, 80), 1);
BEGIN
  IF p_telefone IS NULL OR btrim(p_telefone) = '' THEN
    -- Sem telefone não há como contar. Recusar é o lado seguro: um pedido sem
    -- identidade não deve gastar cota.
    RETURN jsonb_build_object('permitido', false, 'motivo', 'sem_telefone');
  END IF;

  INSERT INTO public.bot_rate_limits AS b (telefone, janela_inicio, contagem, dia, contagem_dia, actualizado_em)
  VALUES (btrim(p_telefone), v_agora, 1, v_dia, 1, v_agora)
  ON CONFLICT (telefone) DO UPDATE SET
    contagem      = CASE WHEN b.janela_inicio < v_agora - INTERVAL '1 minute'
                         THEN 1 ELSE b.contagem + 1 END,
    janela_inicio = CASE WHEN b.janela_inicio < v_agora - INTERVAL '1 minute'
                         THEN v_agora ELSE b.janela_inicio END,
    contagem_dia  = CASE WHEN b.dia < v_dia
                         THEN 1 ELSE b.contagem_dia + 1 END,
    dia           = v_dia,
    actualizado_em = v_agora
  RETURNING * INTO v_linha;

  RETURN jsonb_build_object(
    'permitido', v_linha.contagem <= v_max_min AND v_linha.contagem_dia <= v_max_dia,
    'no_minuto', v_linha.contagem,
    'no_dia',    v_linha.contagem_dia,
    'max_minuto', v_max_min,
    'max_dia',   v_max_dia,
    'motivo', CASE
                WHEN v_linha.contagem     > v_max_min THEN 'minuto'
                WHEN v_linha.contagem_dia > v_max_dia THEN 'dia'
                ELSE NULL
              END
  );
END;
$fn$;

COMMENT ON FUNCTION public.check_bot_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Incrementa e verifica o limite do bot numa unica instrucao atomica. Devolve {permitido, no_minuto, no_dia, motivo}.';

-- ⚠️ O PostgreSQL dá EXECUTE a PUBLIC por omissão — revogar só de anon não chega.
REVOKE ALL ON FUNCTION public.check_bot_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_bot_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.check_bot_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;

-- ── Retenção ─────────────────────────────────────────────────────────────────
-- Estende a limpeza que já corre de hora a hora (`cleanup-bot-runtime-tables`).
-- Uma linha por telefone que alguma vez falou com o bot, para sempre, é o mesmo
-- erro do histórico do cron — só mais pequeno.
CREATE OR REPLACE FUNCTION public.cleanup_bot_runtime_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF to_regclass('public.message_dedup') IS NOT NULL THEN
    DELETE FROM public.message_dedup WHERE created_at < NOW() - INTERVAL '7 days';
  END IF;

  IF to_regclass('public.rate_limit_log') IS NOT NULL THEN
    DELETE FROM public.rate_limit_log WHERE created_at < NOW() - INTERVAL '1 day';
  END IF;

  IF to_regclass('public.bot_rate_limits') IS NOT NULL THEN
    -- 2 dias: chega para o tecto diário fazer sentido (o dia vira a meia-noite
    -- de Luanda) e para investigar abuso recente.
    DELETE FROM public.bot_rate_limits WHERE actualizado_em < NOW() - INTERVAL '2 days';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cleanup_bot_runtime_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_bot_runtime_tables() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_bot_runtime_tables() FROM authenticated;
