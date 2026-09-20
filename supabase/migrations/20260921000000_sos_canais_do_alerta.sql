-- =============================================================================
-- SOS — canais do alerta + as políticas que faltavam para o áudio se ligar
-- =============================================================================
-- Contexto (20/09/2026): ao começar a implementar o plano do SOS descobriu-se
-- que o botão de pânico NUNCA funcionou para um passageiro comum. Não é teoria:
-- está provado em execução com as claims de um passageiro real.
--
-- Duas causas, ambas de RLS, ambas silenciosas:
--
--   1. `persistPanic` faz `insert(payload).select('id')`. Um INSERT com
--      RETURNING precisa de política de SELECT, e o dono não tinha nenhuma.
--      Resultado: erro 42501 e o alerta NUNCA era criado. O erro era engolido
--      porque o código só desestrutura `data`, nunca `error`.
--
--   2. O caminho do áudio faz UPDATE de `audio_storage_path` na linha do
--      alerta. Sem política de UPDATE para o dono, o UPDATE afectava 0 linhas
--      — e o PostgREST devolve sucesso numa actualização de 0 linhas. O áudio
--      ficava no bucket sem ponteiro, para sempre.
--
-- Só o admin conseguia criar alertas (passa pela política de SELECT do admin) —
-- e é exactamente por isso que os DOIS únicos alertas na base são do Dánio.
-- Ele foi sempre a única pessoa que conseguiu carregar no botão.
--
-- Aplicar com:  npx supabase db query --linked --file <este ficheiro>
-- NUNCA com `supabase db push` (histórico remoto dessincronizado).
-- =============================================================================

-- ── 1. Colunas novas: por onde se tentou avisar, e o tamanho do áudio ────────
ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS canais_tentados  TEXT[],
  ADD COLUMN IF NOT EXISTS canal_que_passou TEXT,
  ADD COLUMN IF NOT EXISTS audio_bytes      BIGINT;

COMMENT ON COLUMN public.panic_alerts.canais_tentados IS
  'Por onde se tentou avisar o contacto, pela ordem em que se tentou.';
COMMENT ON COLUMN public.panic_alerts.canal_que_passou IS
  'Qual dos canais entregou mesmo. Nulo enquanto nenhum entregou.';
COMMENT ON COLUMN public.panic_alerts.audio_bytes IS
  'Tamanho da gravacao em bytes. Serve para detectar gravacoes truncadas.';

-- ── 2. `expired` passa a ser um estado válido ──────────────────────────────
-- O plano pede `status = 'expired'` quando a fila expira. A CHECK antiga só
-- aceitava active/resolved/false_alarm — sem isto, o UPDATE rebentava com
-- violação de constraint e a fila continuaria a morrer em silêncio.
ALTER TABLE public.panic_alerts DROP CONSTRAINT IF EXISTS panic_alerts_status_check;
ALTER TABLE public.panic_alerts
  ADD CONSTRAINT panic_alerts_status_check
  CHECK (status IN ('active', 'resolved', 'false_alarm', 'expired'));

-- ── 3. O dono passa a poder LER o próprio alerta ───────────────────────────
-- Sem esta política, o `insert().select('id')` falha. É a causa nº 1.
-- Só abre as linhas do próprio: `auth.uid() = user_id`.
DROP POLICY IF EXISTS panic_select_own ON public.panic_alerts;
CREATE POLICY panic_select_own ON public.panic_alerts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 4. O dono passa a poder LIGAR o áudio e as coordenadas ─────────────────
-- Sem esta, o `update({ audio_storage_path })` afecta 0 linhas e não dá erro.
DROP POLICY IF EXISTS panic_update_own ON public.panic_alerts;
CREATE POLICY panic_update_own ON public.panic_alerts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 5. ...mas não pode silenciar o próprio SOS ────────────────────────────
-- A política acima é larga: sozinha, deixaria o dono escrever
-- `contact_notified_at` e o motor dava o alerta por avisado sem avisar
-- ninguém. Num cenário de coacção — alguém obriga o passageiro a mexer no
-- telemóvel — isso desligava o socorro exactamente quando ele faz falta.
-- Este gatilho deixa passar só o que a app precisa mesmo de escrever:
-- audio_storage_path, lat, lng e audio_bytes.
--
-- ⚠️ Sem SECURITY DEFINER de propósito: é isso que faz `current_user` ser o
-- papel REAL de quem chama (authenticated / service_role / postgres) e não o
-- dono da função. Com SECURITY DEFINER, o servidor era barrado.
CREATE OR REPLACE FUNCTION public.proteger_alertas_panico()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- O servidor (service_role) e o postgres passam sempre.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;

  -- Um admin passa sempre: o painel precisa de fechar alertas.
  IF public.is_admin_secure() THEN RETURN NEW; END IF;

  IF NEW.user_id              IS DISTINCT FROM OLD.user_id
     OR NEW.ride_id           IS DISTINCT FROM OLD.ride_id
     OR NEW.severity          IS DISTINCT FROM OLD.severity
     OR NEW.source            IS DISTINCT FROM OLD.source
     OR NEW.status            IS DISTINCT FROM OLD.status
     OR NEW.resolved_at       IS DISTINCT FROM OLD.resolved_at
     OR NEW.resolved_by       IS DISTINCT FROM OLD.resolved_by
     OR NEW.contact_phone     IS DISTINCT FROM OLD.contact_phone
     OR NEW.contact_notified_at IS DISTINCT FROM OLD.contact_notified_at
     OR NEW.contact_attempts  IS DISTINCT FROM OLD.contact_attempts
     OR NEW.contact_last_error IS DISTINCT FROM OLD.contact_last_error
     OR NEW.driver_name       IS DISTINCT FROM OLD.driver_name
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'O dono do alerta so pode escrever audio_storage_path, lat, lng e audio_bytes';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_proteger_alertas_panico ON public.panic_alerts;
CREATE TRIGGER trg_proteger_alertas_panico
  BEFORE UPDATE ON public.panic_alerts
  FOR EACH ROW EXECUTE FUNCTION public.proteger_alertas_panico();

-- ── 6. Índice para encontrar alertas que nunca saíram ─────────────────────
CREATE INDEX IF NOT EXISTS idx_panic_sem_entrega
  ON public.panic_alerts(created_at)
  WHERE contact_notified_at IS NULL;

-- ── 7. Prova, no fim do próprio ficheiro ──────────────────────────────────
-- (o CLI só imprime o ÚLTIMO resultado, por isso a prova vem por último)
SELECT 'MIGRACAO APLICADA — politicas do dono: '
       || (SELECT count(*)::text FROM pg_policies
           WHERE schemaname='public' AND tablename='panic_alerts'
             AND policyname IN ('panic_select_own','panic_update_own'))
       || '/2 | gatilho: '
       || (SELECT count(*)::text FROM pg_trigger
           WHERE tgrelid='public.panic_alerts'::regclass
             AND tgname='trg_proteger_alertas_panico')
       || '/1 | status aceita expired: '
       || (SELECT (pg_get_constraintdef(oid) LIKE '%expired%')::text
           FROM pg_constraint
           WHERE conrelid='public.panic_alerts'::regclass
             AND conname='panic_alerts_status_check')
       || ' | colunas novas: '
       || (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema='public' AND table_name='panic_alerts'
             AND column_name IN ('canais_tentados','canal_que_passou','audio_bytes'))
       || '/3' AS r;
