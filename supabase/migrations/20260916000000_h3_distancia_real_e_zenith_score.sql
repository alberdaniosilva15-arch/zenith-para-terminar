-- ============================================================================
-- ZENITH RIDE — H3 com distância real até ao ponto de recolha + zenith_score
--
-- ── PORQUÊ ──────────────────────────────────────────────────────────────────
--   Nenhuma das duas funções H3 recebia as coordenadas do passageiro, por isso
--   nenhuma conseguia medir a distância até ao ponto de recolha:
--
--     find_drivers_h3               devolvia `distance_m = 500` FIXO e
--                                   `eta_min = 2` FIXO (placeholders)
--     find_drivers_h3_with_cooldown calculava a distância entre o
--                                   `driver_locations.location` e o
--                                   `profiles.last_known_*` — ou seja, entre
--                                   duas representações da posição DO PRÓPRIO
--                                   MOTORISTA. Não é proximidade ao passageiro.
--
--   Consequência: os consumidores usam a distância para pontuar
--   (`rideService`: `distScore = distance_m * 0.48`; `match-driver`:
--   `distance_m * 0.40`). Com um valor fixo, o termo de proximidade fica
--   CONSTANTE e o ranking passa a decidir-se só por rating/zenith — enganador,
--   mesmo que "funcione".
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--   1. As duas funções passam a receber `p_origin_lat` / `p_origin_lng`
--      (obrigatórios) e calculam a distância real com `ST_Distance` sobre
--      geografia (metros).
--   2. `find_drivers_h3_with_cooldown` passa a devolver também `zenith_score`,
--      que o `computeScore` do match-driver já procurava (caía sempre em 500,
--      deixando `zenithPenalty` fixo em 40 e o bónus de elite sem efeito).
--   3. `find_drivers_h3` passa a ordenar por distância (mais perto primeiro).
--      Com `p_limit`, é a ordenação que decide QUAIS motoristas são devolvidos;
--      ordenar por zenith devolvia os melhores pontuados, ainda que longe.
--
-- ── PORQUE É PRECISO DROP ───────────────────────────────────────────────────
--   `CREATE OR REPLACE FUNCTION` com uma lista de parâmetros diferente NÃO
--   substitui a função — cria um OVERLOAD novo. Isso reintroduziria exactamente
--   o erro PGRST203 que acabámos de corrigir. Por isso o DROP é obrigatório, e
--   está feito dentro da mesma transacção para não haver janela sem função.
--
--   Nada se perde: as definições anteriores estão no git (migrations
--   `20260427170000_rename_motogo_score_to_zenith_score.sql` para o canónico e
--   `20260915233000_fix_find_drivers_h3_overload_ambiguity.sql` para o outro).
--
-- ── CHAMADORES ACTUALIZADOS NA MESMA RONDA ──────────────────────────────────
--   src/services/rideService.ts
--   supabase/functions/match-driver/index.ts
--   supabase/functions/whatsapp-webhook/index.ts
--   Todos já têm as coordenadas de origem em mãos.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. find_drivers_h3 — canónico (rideService, whatsapp-webhook)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.find_drivers_h3(text[], integer);

CREATE FUNCTION public.find_drivers_h3(
  p_h3_indexes text[],
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_limit      integer DEFAULT 8
)
RETURNS TABLE(
  driver_id    uuid,
  driver_name  text,
  avatar_url   text,
  rating       numeric,
  total_rides  int,
  level        text,
  distance_m   double precision,
  eta_min      int,
  heading      numeric,
  zenith_score int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_h3_indexes IS NULL OR array_length(p_h3_indexes, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    COALESCE(
      ST_Distance(
        dl.location::geography,
        ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326)::geography
      ),
      2000
    )::DOUBLE PRECISION AS distance_m,
    -- 400 m/min é a convenção usada pelo rideService (Math.ceil(distance_m/400)).
    -- ⚠️ O match-driver usa 250 e o motor de preços assume 500. Não unifiquei
    -- aqui para não mudar o valor que cada consumidor já espera.
    GREATEST(1, CEIL(
      COALESCE(
        ST_Distance(
          dl.location::geography,
          ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326)::geography
        ),
        2000
      ) / 400.0
    ))::INT AS eta_min,
    dl.heading,
    COALESCE(zs.score, 500) AS zenith_score
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  LEFT JOIN public.zenith_scores zs ON zs.driver_id = dl.driver_id
  WHERE dl.status = 'available'
    AND dl.h3_index_res9 = ANY(p_h3_indexes)
  ORDER BY
    distance_m ASC,
    COALESCE(zs.score, 500) DESC,
    pr.rating DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.find_drivers_h3(text[], double precision, double precision, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_drivers_h3(text[], double precision, double precision, integer)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. find_drivers_h3_with_cooldown — rico (match-driver)
--    DROP + CREATE conforme decidido: acrescenta zenith_score.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.find_drivers_h3_with_cooldown(text[], integer, integer);

CREATE FUNCTION public.find_drivers_h3_with_cooldown(
  p_h3_indexes  text[],
  p_origin_lat  double precision,
  p_origin_lng  double precision,
  p_limit       integer DEFAULT 8,
  p_cooldown_s  integer DEFAULT 30
)
RETURNS TABLE(
  driver_id           uuid,
  driver_name         text,
  rating              numeric,
  distance_m          numeric,
  avatar_url          text,
  total_rides         integer,
  level               text,
  heading             numeric,
  acceptance_rate     numeric,
  cancel_rate         numeric,
  avg_response_time_s numeric,
  zenith_score        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_h3_indexes IS NULL OR array_length(p_h3_indexes, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    p.name::TEXT,
    COALESCE(p.rating, 5.0),
    COALESCE(
      ST_Distance(
        dl.location::geography,
        ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326)::geography
      ),
      2000
    )::NUMERIC,
    p.avatar_url::TEXT,
    COALESCE(p.total_rides, 0)::INT,
    COALESCE(p.level, 'Novato')::TEXT,
    COALESCE(dl.heading, 0),
    COALESCE(p.acceptance_rate, 0.85)::NUMERIC,
    COALESCE(p.cancel_rate, 0.05)::NUMERIC,
    COALESCE(p.avg_response_time_s, 8.0)::NUMERIC,
    COALESCE(zs.score, 500)::INT
  FROM public.driver_locations dl
  INNER JOIN public.profiles p ON p.user_id = dl.driver_id
  LEFT JOIN public.zenith_scores zs ON zs.driver_id = dl.driver_id
  WHERE
    dl.h3_index_res9 = ANY(p_h3_indexes)
    AND dl.status = 'available'
    AND NOT EXISTS (
      SELECT 1
      FROM public.driver_notifications dn
      WHERE dn.driver_id = dl.driver_id
        AND dn.notif_status = 'pending'
        AND dn.created_at > NOW() - (p_cooldown_s || ' seconds')::INTERVAL
    )
  ORDER BY distance_m ASC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.find_drivers_h3_with_cooldown(text[], double precision, double precision, integer, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_drivers_h3_with_cooldown(text[], double precision, double precision, integer, integer)
  TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- Verificação. Esperado: exactamente 2 linhas, sem sobreposição de gamas.
--   find_drivers_h3                     (text[], float8, float8, int)
--   find_drivers_h3_with_cooldown       (text[], float8, float8, int, int)
-- ============================================================================
SELECT p.oid::regprocedure::text AS assinatura,
       p.pronargs                 AS n_args,
       p.pronargdefaults          AS n_defaults,
       format('[%s..%s]', p.pronargs - p.pronargdefaults, p.pronargs) AS gama_aceite
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'find_drivers_h3%'
ORDER BY p.proname;
