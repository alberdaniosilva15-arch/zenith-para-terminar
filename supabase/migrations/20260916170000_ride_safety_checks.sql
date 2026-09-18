-- ════════════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Escada de segurança da corrida (Fase 4)
--
-- PRINCÍPIO DESTA MIGRATION (decisão do Dánio, 16/09/2026):
--   O Postgres guarda ESTADO. O Postgres NÃO pensa.
--   Nada aqui decide o que é "corrida longa", quanto tempo se espera por uma
--   resposta, nem o que diz a mensagem ao contacto de emergência.
--   Tudo isso vive na Edge Function `sos-escalation`.
--
--   O `pg_net` serve para UMA coisa: tocar a campainha de minuto a minuto
--   para a função acordar. Nunca para executar regras de negócio.
--
-- O que fica aqui:
--   1. Tabela `ride_safety_checks`  — o estado da escada, e mais nada.
--   2. Duas RPCs finas para o cliente (ler a pergunta, responder à pergunta).
--   3. `pg_net` + um job de 1 em 1 minuto que chama a função.
--   4. Arranjo do job `safety-watchdog-hourly`, que estava a falhar desde Maio.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. ESTADO
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ride_safety_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ride_id           UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id      UUID NOT NULL,
  driver_id         UUID,

  -- Onde está a escada. Quem escreve isto é a função, não o Postgres.
  --   'pergunta'         — perguntámos "está tudo bem?" e aguardamos resposta
  --   'estou_bem'        — o passageiro confirmou que está tudo bem (fim)
  --   'alerta_admin'     — ninguém respondeu a tempo, ou o passageiro disse que não
  --                        estava bem. O painel de admin já foi avisado.
  --   'whatsapp_enviado' — o contacto de emergência já recebeu a mensagem
  --   'fechado'          — a corrida acabou sem incidente (fim)
  estado            TEXT NOT NULL,

  asked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  answer_deadline   TIMESTAMPTZ NOT NULL,
  answered_at       TIMESTAMPTZ,
  answer            TEXT,

  admin_alerted_at  TIMESTAMPTZ,
  admin_alert_id    UUID,
  whatsapp_deadline TIMESTAMPTZ,
  whatsapp_sent_at  TIMESTAMPTZ,

  -- Último ponto conhecido do carro, copiado do traço da corrida (Fase 3).
  -- Guardado aqui porque a mensagem de WhatsApp é montada pela função e não
  -- deve ter de ir procurar o traço outra vez.
  last_lat          DOUBLE PRECISION,
  last_lng          DOUBLE PRECISION,

  nota              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ride_safety_checks_estado_check CHECK (
    estado IN ('pergunta', 'estou_bem', 'alerta_admin', 'whatsapp_enviado', 'fechado')
  ),
  CONSTRAINT ride_safety_checks_answer_check CHECK (
    answer IS NULL OR answer IN ('estou_bem', 'nao_estou_bem')
  )
);

-- Só pode existir UMA escada aberta por corrida. Sem isto, duas passagens da
-- função ao mesmo tempo criariam duas perguntas ao passageiro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ride_safety_open
  ON public.ride_safety_checks(ride_id)
  WHERE estado IN ('pergunta', 'alerta_admin', 'whatsapp_enviado');

-- As duas consultas que a função faz em cada passagem.
CREATE INDEX IF NOT EXISTS idx_ride_safety_prazo_resposta
  ON public.ride_safety_checks(estado, answer_deadline)
  WHERE estado = 'pergunta';

CREATE INDEX IF NOT EXISTS idx_ride_safety_prazo_whatsapp
  ON public.ride_safety_checks(estado, whatsapp_deadline)
  WHERE estado = 'alerta_admin';

-- Bookkeeping puro: manter `updated_at` certo sem depender de quem escreve.
CREATE OR REPLACE FUNCTION public.touch_ride_safety_checks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ride_safety_checks ON public.ride_safety_checks;
CREATE TRIGGER trg_touch_ride_safety_checks
  BEFORE UPDATE ON public.ride_safety_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ride_safety_checks();


-- ════════════════════════════════════════════════════════════════════════════
-- 2. RLS
--    O passageiro LÊ a sua pergunta. Não escreve nada directamente — responde
--    pela RPC, que só toca nas colunas da resposta. Uma política de UPDATE
--    directa deixaria o passageiro reescrever o prazo ou o estado da escada.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ride_safety_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ride_safety: participantes leem" ON public.ride_safety_checks;
CREATE POLICY "ride_safety: participantes leem"
  ON public.ride_safety_checks
  FOR SELECT TO authenticated
  USING (
    passenger_id = auth.uid()
    OR driver_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "ride_safety: service_role escreve" ON public.ride_safety_checks;
CREATE POLICY "ride_safety: service_role escreve"
  ON public.ride_safety_checks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Sem política de INSERT/UPDATE/DELETE para `authenticated` de propósito:
-- escrever aqui é exclusivo da função (service_role) e da RPC de resposta.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. RPCs FINAS PARA O CLIENTE
-- ════════════════════════════════════════════════════════════════════════════

-- Lê a escada aberta de uma corrida (ou null se não houver nenhuma).
CREATE OR REPLACE FUNCTION public.get_ride_safety_check(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_linha public.ride_safety_checks;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_linha
  FROM public.ride_safety_checks
  WHERE ride_id = p_ride_id
    AND estado IN ('pergunta', 'alerta_admin', 'whatsapp_enviado')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Só quem está na corrida (ou um admin) vê isto.
  IF NOT (v_linha.passenger_id = v_uid OR v_linha.driver_id = v_uid OR public.is_admin()) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',              v_linha.id,
    'ride_id',         v_linha.ride_id,
    'estado',          v_linha.estado,
    'asked_at',        v_linha.asked_at,
    'answer_deadline', v_linha.answer_deadline,
    'answered_at',     v_linha.answered_at,
    'answer',          v_linha.answer
  );
END;
$$;

-- Responde à pergunta. Só mexe no que é da resposta: `answer`, `answered_at`
-- e o degrau. Os PRAZOS não se tocam aqui — quem os calcula é a função.
--
-- `estou_bem`     -> fecha a escada
-- `nao_estou_bem` -> salta o degrau do silêncio e vai directo ao admin
CREATE OR REPLACE FUNCTION public.answer_ride_safety_check(
  p_check_id UUID,
  p_resposta TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_linha public.ride_safety_checks;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_sessao');
  END IF;

  IF p_resposta NOT IN ('estou_bem', 'nao_estou_bem') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_invalida');
  END IF;

  SELECT * INTO v_linha
  FROM public.ride_safety_checks
  WHERE id = p_check_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Só o passageiro responde. O motorista e o admin não respondem por ele —
  -- responder "estou bem" por outra pessoa é exactamente o que isto evita.
  IF v_linha.passenger_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_o_passageiro');
  END IF;

  IF v_linha.estado <> 'pergunta' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_resolvido', 'estado', v_linha.estado);
  END IF;

  UPDATE public.ride_safety_checks
  SET
    answer      = p_resposta,
    answered_at = now(),
    estado      = CASE WHEN p_resposta = 'estou_bem' THEN 'estou_bem' ELSE 'alerta_admin' END
  WHERE id = p_check_id;

  RETURN jsonb_build_object('ok', true, 'estado', CASE WHEN p_resposta = 'estou_bem' THEN 'estou_bem' ELSE 'alerta_admin' END);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_safety_check(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ride_safety_check(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_ride_safety_check(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ride_safety_check(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. REALTIME — o aviso "está tudo bem?" tem de aparecer sem o passageiro
--    ter de recarregar a página.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ride_safety_checks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_safety_checks;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Nao foi possivel adicionar ride_safety_checks ao realtime: %', SQLERRM;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. O SINO — pg_net + pg_cron
--
--    `pg_net` estava disponível (0.20.0) mas nunca tinha sido instalado. Sem
--    ele, `net.http_post` não existe e QUALQUER job que o use falha. Era o que
--    estava a acontecer ao `safety-watchdog-hourly` desde Maio — provado em
--    `cron.job_run_details` com `ERROR: schema "net" does not exist`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

-- O sino da escada SOS: de minuto a minuto, acorda a função e sai de cena.
-- O segredo NÃO fica escrito aqui — vive no Vault do Supabase, sob o nome
-- `cron_secret`, criado fora do repositório:
--     SELECT vault.create_secret('<valor>', 'cron_secret', '…');
-- (O `ALTER DATABASE … SET app.settings.x` NÃO serve neste projecto: o role
--  `postgres` não é superuser e responde `42501 permission denied`.)
-- Se o segredo faltar, o job FALHA À VISTA em vez de ficar em silêncio a não
-- fazer nada — vê-se em `cron.job_run_details`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sos-escalation-a-cada-minuto') THEN
      PERFORM cron.unschedule('sos-escalation-a-cada-minuto');
    END IF;

    PERFORM cron.schedule(
      'sos-escalation-a-cada-minuto',
      '* * * * *',
      $cron$
        DO $corpo$
        DECLARE
          v_segredo TEXT;
        BEGIN
          SELECT decrypted_secret INTO v_segredo
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
          LIMIT 1;

          IF v_segredo IS NULL OR v_segredo = '' THEN
            RAISE EXCEPTION 'Segredo cron_secret em falta no Vault — a escada SOS nao pode ser accionada';
          END IF;

          PERFORM net.http_post(
            url     := 'https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/sos-escalation',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', v_segredo
            ),
            body    := '{}'::jsonb,
            timeout_milliseconds := 10000
          );
        END
        $corpo$;
      $cron$
    );
    RAISE NOTICE 'Job sos-escalation-a-cada-minuto agendado.';
  ELSE
    RAISE NOTICE 'pg_net indisponivel — a escada SOS depende do cron externo.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Nao foi possivel agendar a escada SOS: %', SQLERRM;
END $$;

-- Arranjo do watchdog horário. Estava a chamar `net.http_post` a pedir
-- `app.settings.service_role_key`, que TAMBÉM nunca existiu. Passa a usar o
-- mesmo segredo do sino, e a função `safety-watchdog` aceita-o.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'safety-watchdog-hourly') THEN
      PERFORM cron.unschedule('safety-watchdog-hourly');
    END IF;

    PERFORM cron.schedule(
      'safety-watchdog-hourly',
      '0 * * * *',
      $cron$
        DO $corpo$
        DECLARE
          v_segredo TEXT;
        BEGIN
          SELECT decrypted_secret INTO v_segredo
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
          LIMIT 1;

          IF v_segredo IS NULL OR v_segredo = '' THEN
            RAISE EXCEPTION 'Segredo cron_secret em falta no Vault — o safety-watchdog nao pode ser accionado';
          END IF;

          PERFORM net.http_post(
            url     := 'https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/safety-watchdog',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', v_segredo
            ),
            body    := '{}'::jsonb,
            timeout_milliseconds := 10000
          );
        END
        $corpo$;
      $cron$
    );
    RAISE NOTICE 'Job safety-watchdog-hourly reagendado com o segredo correcto.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Nao foi possivel reagendar o safety-watchdog: %', SQLERRM;
END $$;
