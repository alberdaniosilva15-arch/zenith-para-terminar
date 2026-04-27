WITH
required_tables(schema_name, object_name) AS (
  VALUES
    ('public', 'users'),
    ('public', 'profiles'),
    ('public', 'rides'),
    ('public', 'driver_locations'),
    ('public', 'zone_prices'),
    ('public', 'referrals'),
    ('public', 'wallets'),
    ('public', 'transactions'),
    ('public', 'posts'),
    ('public', 'ride_predictions'),
    ('public', 'whatsapp_sessions'),
    ('public', 'panic_alerts'),
    ('public', 'driver_documents'),
    ('public', 'fleets'),
    ('public', 'fleet_cars'),
    ('public', 'fleet_driver_agreements'),
    ('public', 'fleet_subscriptions'),
    ('public', 'fleet_billing_events'),
    ('public', 'service_pricing'),
    ('public', 'premium_bookings'),
    ('public', 'cargo_bookings'),
    ('public', 'charter_bookings')
),
required_columns(schema_name, table_name, column_name) AS (
  VALUES
    ('public', 'profiles', 'chat_quota'),
    ('public', 'posts', 'expires_at'),
    ('public', 'users', 'suspended_until'),
    ('public', 'driver_documents', 'bi_storage_path'),
    ('public', 'driver_documents', 'expires_at'),
    ('public', 'panic_alerts', 'severity'),
    ('public', 'panic_alerts', 'audio_storage_path'),
    ('public', 'premium_bookings', 'notify_me'),
    ('public', 'premium_bookings', 'route_stops'),
    ('public', 'premium_bookings', 'pricing_snapshot')
),
required_functions(schema_name, function_name) AS (
  VALUES
    ('public', 'is_admin_secure'),
    ('public', 'set_my_role_driver'),
    ('public', 'set_my_role_fleet_owner'),
    ('public', 'decrement_chat_quota'),
    ('public', 'recharge_chat_quota'),
    ('public', 'approve_driver_document'),
    ('public', 'admin_set_user_suspension'),
    ('public', 'admin_set_user_role'),
    ('public', 'calculate_fare_engine_pro_with_rate_limit'),
    ('public', 'get_zones_demand')
),
required_buckets(bucket_id) AS (
  VALUES
    ('avatars'),
    ('driver_docs'),
    ('panic-audio'),
    ('voice-messages')
),
required_policies(schema_name, table_name, policy_name) AS (
  VALUES
    ('public', 'users', 'users admin read'),
    ('public', 'users', 'users admin update'),
    ('public', 'profiles', 'Admins can view all profiles'),
    ('public', 'driver_documents', 'driver_documents: admin sees all'),
    ('public', 'driver_documents', 'driver_documents: admin updates'),
    ('public', 'referrals', 'referrals admin read'),
    ('public', 'rides', 'rides admin read'),
    ('public', 'driver_locations', 'driver_locations admin read'),
    ('public', 'panic_alerts', 'panic_update_admin'),
    ('public', 'service_pricing', 'service_pricing admin manage'),
    ('public', 'premium_bookings', 'premium bookings admin read'),
    ('public', 'premium_bookings', 'premium bookings admin update'),
    ('public', 'fleet_billing_events', 'fleet billing owner read')
),
required_enums(schema_name, type_name, enum_value) AS (
  VALUES
    ('public', 'user_role', 'fleet_owner')
),
checks AS (
  SELECT
    'table' AS item_type,
    schema_name || '.' || object_name AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM information_schema.tables t
        WHERE t.table_schema = required_tables.schema_name
          AND t.table_name = required_tables.object_name
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_tables

  UNION ALL

  SELECT
    'column' AS item_type,
    schema_name || '.' || table_name || '.' || column_name AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = required_columns.schema_name
          AND c.table_name = required_columns.table_name
          AND c.column_name = required_columns.column_name
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_columns

  UNION ALL

  SELECT
    'function' AS item_type,
    schema_name || '.' || function_name || '()' AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = required_functions.schema_name
          AND p.proname = required_functions.function_name
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_functions

  UNION ALL

  SELECT
    'bucket' AS item_type,
    'storage.' || bucket_id AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM storage.buckets b
        WHERE b.id = required_buckets.bucket_id
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_buckets

  UNION ALL

  SELECT
    'policy' AS item_type,
    schema_name || '.' || table_name || ' / ' || policy_name AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = required_policies.schema_name
          AND p.tablename = required_policies.table_name
          AND p.policyname = required_policies.policy_name
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_policies

  UNION ALL

  SELECT
    'enum' AS item_type,
    schema_name || '.' || type_name || ' = ' || enum_value AS item,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = required_enums.schema_name
          AND t.typname = required_enums.type_name
          AND e.enumlabel = required_enums.enum_value
      ) THEN 'OK'
      ELSE 'MISSING'
    END AS status
  FROM required_enums
)
SELECT
  item_type,
  item,
  status,
  (SELECT COUNT(*) FROM checks WHERE status = 'OK') AS ok_total,
  (SELECT COUNT(*) FROM checks WHERE status = 'MISSING') AS missing_total
FROM checks
ORDER BY
  CASE item_type
    WHEN 'table' THEN 1
    WHEN 'column' THEN 2
    WHEN 'function' THEN 3
    WHEN 'bucket' THEN 4
    WHEN 'policy' THEN 5
    WHEN 'enum' THEN 6
    ELSE 99
  END,
  item;
