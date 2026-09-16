-- ════════════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Traço real da corrida (`ride_track_points`)
-- 16/09/2026
--
-- PORQUE EXISTE
--   O `driver_locations` guarda a posição do motorista com um UPSERT por
--   `driver_id` (`onConflict: 'driver_id'`). Isso significa que cada envio
--   APAGA o anterior: no fim de uma corrida só existe a última posição.
--   Não há histórico nenhum — e sem histórico:
--     • o recibo não pode desenhar a rota que o carro REALMENTE fez;
--     • o SOS não pode dizer onde o carro andou;
--     • não se prova nada numa disputa.
--
--   Esta tabela é o registo. Uma linha por ponto, nunca sobreposta.
--
-- DECISÕES DO DÁNIO (16/09/2026)
--   • Um ponto a cada 20 s  (numa corrida de 30 min dá ~90 pontos)
--   • Retenção de 90 dias
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ride_track_points (
  id          BIGSERIAL PRIMARY KEY,
  ride_id     UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id   UUID NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading     DOUBLE PRECISION,
  speed_kmh   DOUBLE PRECISION,
  accuracy_m  DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A leitura é sempre "o traço desta corrida, por ordem". Este índice serve
-- essa consulta exacta e evita uma ordenação em memória.
CREATE INDEX IF NOT EXISTS ride_track_points_ride_tempo
  ON public.ride_track_points (ride_id, recorded_at);

-- Para a purga por idade não varrer a tabela toda.
CREATE INDEX IF NOT EXISTS ride_track_points_retencao
  ON public.ride_track_points (recorded_at);

ALTER TABLE public.ride_track_points ENABLE ROW LEVEL SECURITY;

-- ── Quem lê ─────────────────────────────────────────────────────────────────
--  O passageiro daquela corrida, o motorista daquela corrida, ou um admin.
--  Ninguém mais. O traço é a localização de uma pessoa — não é dado público.
DROP POLICY IF EXISTS "ride_track_points: participantes leem o traco" ON public.ride_track_points;
CREATE POLICY "ride_track_points: participantes leem o traco"
  ON public.ride_track_points FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_track_points.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

-- ── Quem escreve ────────────────────────────────────────────────────────────
--  Só o motorista daquela corrida, e só em nome próprio. O `WITH CHECK` duplo
--  impede que um motorista escreva pontos numa corrida que não é dele.
DROP POLICY IF EXISTS "ride_track_points: motorista escreve o seu traco" ON public.ride_track_points;
CREATE POLICY "ride_track_points: motorista escreve o seu traco"
  ON public.ride_track_points FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_track_points.ride_id
        AND r.driver_id = auth.uid()
    )
  );

-- Sem UPDATE nem DELETE para clientes: um ponto gravado não se reescreve.
-- (A purga por idade corre como `service_role`, que ignora RLS.)


-- ════════════════════════════════════════════════════════════════════════════
-- RETENÇÃO — 90 dias
-- Segue o padrão do `purge_old_ai_logs` (20260502_cron_cleanup.sql): uma RPC
-- que pode ser chamada por cron, mais uma tentativa de agendar com pg_cron
-- (só existe em planos Pro/Enterprise — se falhar, usa-se o cron externo).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.purge_ride_track_points()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  apagados integer;
BEGIN
  DELETE FROM public.ride_track_points
  WHERE recorded_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS apagados = ROW_COUNT;
  RETURN apagados;
END;
$$;

-- Só o service_role (cron) pode purgar. Um utilizador autenticado não pode
-- apagar o traço das suas próprias corridas — seria apagar a prova.
REVOKE ALL ON FUNCTION public.purge_ride_track_points() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_ride_track_points() FROM anon;
REVOKE ALL ON FUNCTION public.purge_ride_track_points() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ride_track_points() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge_ride_track_points_diario',
      '30 3 * * *',
      'SELECT public.purge_ride_track_points();'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Sem pg_cron (plano Free) isto não é um erro: o cron externo trata disso.
    RAISE NOTICE 'pg_cron indisponivel — usar o cron externo para purge_ride_track_points()';
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- CONTAGEM — diagnóstico barato
-- Permite responder "quantos pontos é que esta corrida tem?" sem trazer o
-- traço inteiro para o cliente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ride_track_count(p_ride_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER          -- respeita a RLS: quem não pode ler, não conta
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.ride_track_points
  WHERE ride_id = p_ride_id;
$$;

-- ⚠️ O PostgreSQL dá EXECUTE a PUBLIC por omissão num CREATE FUNCTION. Sem o
--    REVOKE abaixo, a chave anónima consegue chamar isto. Não vaza nada (é
--    SECURITY INVOKER e a RLS esconde as linhas, devolvendo sempre 0), mas o
--    resto do repositório revoga sempre de `anon` — e uma superfície a mais
--    é uma superfície a mais.
REVOKE ALL ON FUNCTION public.ride_track_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ride_track_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ride_track_count(uuid) TO authenticated, service_role;
