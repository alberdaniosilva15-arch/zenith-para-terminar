-- ============================================================================
-- ZENITH RIDE — Corrige a ambiguidade de overload de find_drivers_h3
--
-- ── SINTOMA (reproduzido contra produção a 2026-09-15) ──────────────────────
--   POST /rest/v1/rpc/find_drivers_h3  {"p_h3_indexes":[...], "p_limit":8}
--   -> HTTP 300  PGRST203
--   "Could not choose the best candidate function between:
--      public.find_drivers_h3(p_h3_indexes => text[], p_limit => integer),
--      public.find_drivers_h3(p_h3_indexes => text[], p_limit => integer,
--                             p_cooldown_s => integer)"
--   hint: "Try renaming the parameters or the function itself in the database
--          so function overloading can be resolved"
--
-- ── CAUSA ───────────────────────────────────────────────────────────────────
--   Dois overloads do mesmo nome, com gamas de argumentos que se sobrepõem:
--
--     find_drivers_h3(text[], integer)          n_args=2  defaults=1  [1..2]
--     find_drivers_h3(text[], integer, integer) n_args=3  defaults=2  [1..3]
--
--   Uma chamada com 2 argumentos casa com ambos -> o PostgREST recusa.
--
-- ── PORQUE NÃO SE APAGA O SEGUNDO ───────────────────────────────────────────
--   O overload de 3 argumentos não é lixo. É uma implementação MELHOR que a
--   canónica, e é a que o match-driver espera:
--
--     canónico (2 args)        | 3 args (órfão)
--     -------------------------|-----------------------------------------------
--     distance_m = 500 FIXO     | ST_Distance(...) REAL
--     eta_min = 2 FIXO          | (não devolve eta_min)
--     sem cooldown              | exclui motoristas com notificação pendente
--     zenith_score              | acceptance_rate, cancel_rate,
--                               | avg_response_time_s
--
--   O match-driver/index.ts já lê `acceptance_rate`, `cancel_rate` e
--   `avg_response_time_s` com fallback — foi escrito para esta versão.
--   O rideService.ts usa `zenith_score` — foi escrito para a canónica.
--   São dois contratos diferentes que colidiram no mesmo nome.
--
-- ── IMPACTO ATÉ AGORA ───────────────────────────────────────────────────────
--   Os três call-sites passam 2 argumentos e engolem o erro
--   (console.warn + continue):
--     src/services/rideService.ts:178
--     supabase/functions/match-driver/index.ts:123
--     supabase/functions/whatsapp-webhook/index.ts:810
--   Logo, a via rápida H3 nunca correu e todas as buscas de motorista caíram
--   no scan PostGIS por raio.
--
-- ── CORRECÇÃO ───────────────────────────────────────────────────────────────
--   Passo 1: renomear o órfão. Preserva corpo, OID e GRANTs (as permissões
--            vivem no OID). É reversível com um ALTER FUNCTION ... RENAME TO.
--            Nada é apagado.
--   Passo 2: versionar a definição sob o nome novo, para que uma reconstrução
--            de raiz da base de dados produza o mesmo resultado.
-- ============================================================================

-- ── Passo 1: libertar o nome canónico ───────────────────────────────────────
DO $$
DECLARE
  v_assinatura text;
  v_ja_existe  boolean;
BEGIN
  -- O órfão: mesmo nome, 3 argumentos.
  SELECT p.oid::regprocedure::text
    INTO v_assinatura
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'find_drivers_h3'
    AND p.pronargs = 3
  LIMIT 1;

  IF v_assinatura IS NULL THEN
    RAISE NOTICE '[find_drivers_h3] Não existe overload de 3 argumentos. Nada a fazer.';
    RETURN;
  END IF;

  -- Segurança: só avanço se o canónico de 2 argumentos estiver presente.
  -- Sem ele, renomear deixaria o nome find_drivers_h3 sem nenhuma função.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'find_drivers_h3'
      AND p.pronargs = 2
  ) THEN
    RAISE WARNING '[find_drivers_h3] Não encontrei o canónico de 2 argumentos. '
                  'Não renomeio nada, para não deixar o nome vazio.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'find_drivers_h3_with_cooldown'
  ) INTO v_ja_existe;

  IF v_ja_existe THEN
    RAISE NOTICE '[find_drivers_h3] find_drivers_h3_with_cooldown já existe. Nada a fazer.';
    RETURN;
  END IF;

  EXECUTE format('ALTER FUNCTION %s RENAME TO find_drivers_h3_with_cooldown', v_assinatura);
  RAISE NOTICE '[find_drivers_h3] Overload de 3 argumentos renomeado: %', v_assinatura;
END $$;

-- ── Passo 2: versionar a definição sob o nome novo ──────────────────────────
-- Idempotente: se o Passo 1 correu, este CREATE OR REPLACE reescreve o mesmo
-- corpo. Numa base de dados reconstruída de raiz, é este passo que a cria.
CREATE OR REPLACE FUNCTION public.find_drivers_h3_with_cooldown(
  p_h3_indexes text[],
  p_limit integer DEFAULT 8,
  p_cooldown_s integer DEFAULT 30
)
RETURNS TABLE(
  driver_id uuid,
  driver_name text,
  rating numeric,
  distance_m numeric,
  avatar_url text,
  total_rides integer,
  level text,
  heading numeric,
  acceptance_rate numeric,
  cancel_rate numeric,
  avg_response_time_s numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    dl.driver_id,
    p.name::TEXT,
    COALESCE(p.rating, 5.0),
    COALESCE(
      ST_Distance(
        dl.location::geography,
        ST_SetSRID(ST_Point(p.last_known_lng, p.last_known_lat), 4326)::geography
      ),
      2000
    )::NUMERIC,
    p.avatar_url::TEXT,
    COALESCE(p.total_rides, 0)::INT,
    COALESCE(p.level, 'Novato')::TEXT,
    COALESCE(dl.heading, 0),
    COALESCE(p.acceptance_rate, 0.85)::NUMERIC,
    COALESCE(p.cancel_rate, 0.05)::NUMERIC,
    COALESCE(p.avg_response_time_s, 8.0)::NUMERIC
  FROM public.driver_locations dl
  INNER JOIN public.profiles p ON p.user_id = dl.driver_id
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

-- Permissões: iguais às do canónico. O `anon` fica de fora — a função é
-- SECURITY DEFINER e expõe posições de motoristas.
REVOKE ALL ON FUNCTION public.find_drivers_h3_with_cooldown(text[], integer, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_drivers_h3_with_cooldown(text[], integer, integer)
  TO authenticated, service_role;

-- ============================================================================
-- Verificação. Esperado:
--   find_drivers_h3(text[],integer)                    gama [1..2]  <- canónico
--   find_drivers_h3_with_cooldown(text[],int,int)      gama [1..3]  <- órfão
-- Só pode existir UMA função chamada find_drivers_h3.
-- ============================================================================
SELECT p.oid::regprocedure::text AS assinatura,
       p.pronargs                 AS n_args,
       p.pronargdefaults          AS n_defaults,
       format('[%s..%s]', p.pronargs - p.pronargdefaults, p.pronargs) AS gama_aceite
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname = 'find_drivers_h3' OR p.proname = 'find_drivers_h3_with_cooldown')
ORDER BY p.proname, p.pronargs;
