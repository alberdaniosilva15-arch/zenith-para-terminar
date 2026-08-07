-- ═══════════════════════════════════════════════════════════════
-- DIAGNÓSTICO COMPLETO — Zenith Ride v3.1
-- Cola este SQL no SQL Editor do Supabase Dashboard.
-- Mostra: tabelas que existem, tabelas em falta, e RLS policies.
-- ═══════════════════════════════════════════════════════════════

WITH expected_tables AS (
  SELECT unnest(ARRAY[
    -- Core
    'users', 'profiles', 'rides', 'ratings',
    -- Motoristas
    'driver_locations', 'driver_documents', 'driver_notifications',
    -- Financeiro
    'wallets', 'transactions', 'pending_payments',
    -- Pricing
    'zone_prices', 'zone_surge_overrides', 'pricing_config', 'service_pricing',
    -- Premium
    'premium_bookings', 'charter_bookings', 'cargo_bookings', 'contracts',
    -- IA & Logs
    'ai_usage_logs', 'ai_event_logs', 'admin_knowledge',
    -- Segurança
    'panic_alerts', 'safety_watchdog_alerts', 'route_deviation_alerts',
    -- WhatsApp
    'whatsapp_sessions', 'geocoding_cache',
    -- Tracking
    'ride_tracking_shares', 'demand_heatmap',
    -- Referrals
    'referrals',
    -- Rate Limiting
    'ip_rate_limits',
    -- CRM
    'tenants', 'app_settings',
    -- Scores
    'motogo_scores'
  ]) AS table_name
),
existing_tables AS (
  SELECT tablename AS table_name
  FROM pg_tables
  WHERE schemaname = 'public'
),
rls_status AS (
  SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
policy_count AS (
  SELECT
    c.relname AS table_name,
    count(p.polname) AS num_policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname
)
SELECT
  e.table_name,
  CASE WHEN ex.table_name IS NOT NULL THEN '✅ EXISTE' ELSE '❌ EM FALTA' END AS estado,
  CASE WHEN r.rls_enabled THEN '🔒 ON' ELSE '🔓 OFF' END AS rls,
  COALESCE(pc.num_policies, 0) AS policies
FROM expected_tables e
LEFT JOIN existing_tables ex ON ex.table_name = e.table_name
LEFT JOIN rls_status r ON r.table_name = e.table_name
LEFT JOIN policy_count pc ON pc.table_name = e.table_name
ORDER BY
  CASE WHEN ex.table_name IS NULL THEN 0 ELSE 1 END,
  e.table_name;
