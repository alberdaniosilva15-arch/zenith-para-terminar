-- =============================================================================
-- SETUP HELPER — SECURITY DEFINER para criar dados de teste
-- =============================================================================
-- Hash bcrypt pré-computado de 'test123' (precisa de pgcrypto ou auth.users trigger)
-- Se auth.users rejeitar, criamos só os dados públicos.

CREATE OR REPLACE FUNCTION public._test_setup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_driver_id    UUID := '22222222-2222-2222-2222-222222222222';
  v_other_id     UUID := '33333333-3333-3333-3333-333333333333';
  v_admin_id     UUID := '44444444-4444-4444-4444-444444444444';
BEGIN
  -- Inserir em auth.users primeiro (necessário para FK de public.users)
  BEGIN
    INSERT INTO auth.users (id, email, encrypted_password, role, email_confirmed_at, created_at, updated_at)
    VALUES
      (v_passenger_id, 'test_passenger@test.com', '$2a$10$dummy_hash_for_test_only', 'authenticated', NOW(), NOW(), NOW()),
      (v_driver_id, 'test_driver@test.com', '$2a$10$dummy_hash_for_test_only', 'authenticated', NOW(), NOW(), NOW()),
      (v_other_id, 'test_other@test.com', '$2a$10$dummy_hash_for_test_only', 'authenticated', NOW(), NOW(), NOW()),
      (v_admin_id, 'test_admin@test.com', '$2a$10$dummy_hash_for_test_only', 'authenticated', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Aviso: não conseguiu inserir em auth.users: %', SQLERRM;
    RAISE NOTICE 'Os testes de JWT simulation ainda funcionam com public.users isolado.';
  END;

  INSERT INTO public.users (id, email, role)
  VALUES
    (v_passenger_id, 'test_passenger@test.com', 'passenger'),
    (v_driver_id, 'test_driver@test.com', 'driver'),
    (v_other_id, 'test_other@test.com', 'passenger'),
    (v_admin_id, 'test_admin@test.com', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.profiles (user_id, name, phone, rating, total_rides, level)
  VALUES
    (v_passenger_id, 'Test Passenger', '+244900000001', 4.5, 10, 'Novato'),
    (v_driver_id, 'Test Driver', '+244900000002', 4.8, 50, 'Ouro'),
    (v_other_id, 'Test Other', '+244900000003', 4.0, 5, 'Novato'),
    (v_admin_id, 'Test Admin', '+244900000004', 5.0, 100, 'Diamante')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.driver_locations (driver_id, status, location, h3_index_res9, h3_index_res7, heading, updated_at)
  VALUES
    (v_driver_id, 'available', ST_SetSRID(ST_MakePoint(13.2343, -8.8368), 4326), '8928308280fffff', '87283082803ffff', 90, NOW())
  ON CONFLICT (driver_id) DO UPDATE SET status = 'available', updated_at = NOW();

  RAISE NOTICE 'Setup concluído: passageiro=% motorista=% outro=% admin=%', v_passenger_id, v_driver_id, v_other_id, v_admin_id;
END;
$$;

SELECT public._test_setup();

CREATE OR REPLACE FUNCTION public._test_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ids UUID[] := ARRAY[
    '11111111-1111-1111-1111-111111111111'::UUID,
    '22222222-2222-2222-2222-222222222222'::UUID,
    '33333333-3333-3333-3333-333333333333'::UUID,
    '44444444-4444-4444-4444-444444444444'::UUID,
    '55555555-5555-5555-5555-555555555555'::UUID
  ];
BEGIN
  -- Limpar só os dados que criámos (não tenta apagar auth.users por causa de FKs)
  DELETE FROM public.rides WHERE passenger_id = ANY(v_ids) OR driver_id = ANY(v_ids);
  DELETE FROM public.driver_locations WHERE driver_id = ANY(v_ids);
  DELETE FROM public.profiles WHERE user_id = ANY(v_ids);
  DELETE FROM public.users WHERE id = ANY(v_ids);
  -- auth.users fica com os registos de teste (UUIDs inofensivos, não afeta produção)
  RAISE NOTICE 'Cleanup concluído (auth.users mantido — dados de teste inofensivos).';
END;
$$;
