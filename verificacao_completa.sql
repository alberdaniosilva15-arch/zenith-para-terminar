-- =============================================================================
-- ZENITH RIDE v3.5.4 — VERIFICAÇÃO COMPLETA DA BD (CORRIGIDO)
-- Resultado: tabela com nome, tipo (table/function/bucket) e status (✅/❌)
-- FIX: ORDER BY movido para fora do UNION ALL (PostgreSQL não aceita CASE no ORDER BY de UNION)
-- =============================================================================

WITH expected_tables(tbl) AS (
  VALUES
    -- ══ TABELAS CORE ══
    ('users'),
    ('profiles'),
    ('rides'),
    ('driver_locations'),
    ('wallets'),
    ('transactions'),
    ('contracts'),
    ('ratings'),
    ('posts'),
    ('user_privacy'),
    -- ══ TABELAS DE FEATURES ══
    ('referrals'),
    ('ride_predictions'),
    ('motogo_scores'),
    ('motogopay_partners'),
    ('zone_prices'),
    ('demand_heatmap'),
    ('driver_documents'),
    ('school_tracking_sessions'),
    ('ride_tracking_shares'),
    ('panic_alerts'),
    ('driver_insurance'),
    ('cash_advances'),
    ('pricing_config'),
    ('api_rate_limits'),
    ('geocoding_cache'),
    ('ride_messages'),
    ('price_feedback'),
    ('scheduled_rides'),
    ('route_deviation_alerts'),
    ('driver_notifications'),
    ('ai_usage_logs'),
    ('ip_rate_limits')
),
table_check AS (
  SELECT
    e.tbl AS nome,
    'tabela' AS tipo,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = e.tbl
      ) THEN '✅ Existe'
      ELSE '❌ NÃO EXISTE'
    END AS estado
  FROM expected_tables e
),

-- ══ FUNÇÕES RPC ══
expected_functions(fn, args) AS (
  VALUES
    ('accept_ride_atomic',           'uuid, uuid'),
    ('decline_ride_atomic',          'uuid, uuid'),
    ('create_selected_ride_atomic',  'uuid, uuid, text, ...'),
    ('cancel_ride_safe',             'uuid, uuid, text'),
    ('get_active_ride',              'uuid'),
    ('find_drivers_h3',              'text[], integer'),
    ('find_nearby_drivers',          'double precision x4, integer'),
    ('find_drivers_for_auction',     'double precision x3, integer'),
    ('process_ride_payment_v3',      '11 params'),
    ('validate_tracking_token',      'uuid'),
    ('ensure_user_exists',           'uuid, text, text, text'),
    ('is_admin_secure',              ''),
    ('set_my_role_driver',           ''),
    ('check_rate_limit',             'uuid, varchar, integer, integer'),
    ('recharge_chat_quota',          'uuid, integer'),
    ('calculate_fare_engine_pro',    'variavel')
),
function_check AS (
  SELECT
    e.fn AS nome,
    'funcao RPC' AS tipo,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.routines r
        WHERE r.routine_schema = 'public' AND r.routine_name = e.fn
      ) THEN '✅ Existe'
      ELSE '❌ NÃO EXISTE'
    END AS estado
  FROM expected_functions e
),

-- ══ STORAGE BUCKETS ══
expected_buckets(bkt) AS (
  VALUES
    ('avatars'),
    ('driver-docs'),
    ('panic-audio'),
    ('voice-messages')
),
bucket_check AS (
  SELECT
    e.bkt AS nome,
    'bucket' AS tipo,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM storage.buckets b WHERE b.id = e.bkt
      ) THEN '✅ Existe'
      ELSE '❌ NÃO EXISTE'
    END AS estado
  FROM expected_buckets e
)

-- ══ RESULTADO FINAL (corrigido: subquery + ORDER BY fora do UNION) ══
SELECT * FROM (
  SELECT nome, tipo, estado, 1 AS ordem_tipo FROM table_check
  UNION ALL
  SELECT '───────────', '─────', '───────────', 2
  UNION ALL
  SELECT nome, tipo, estado, 3 FROM function_check
  UNION ALL
  SELECT '───────────', '─────', '───────────', 4
  UNION ALL
  SELECT nome, tipo, estado, 5 FROM bucket_check
) AS resultados
ORDER BY ordem_tipo, nome;
