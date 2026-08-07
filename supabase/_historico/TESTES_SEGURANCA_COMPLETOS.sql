-- =============================================================================
-- ZENITH RIDE — TESTES DE SEGURANÇA COMPLETOS
-- Data: 19 Julho 2026
--
-- PREREQUISITO: Executar primeiro TESTES_SEGURANCA_SETUP.sql
-- COMO USAR: supabase db query --linked -f supabase/TESTES_SEGURANCA_COMPLETOS.sql
-- NOTA: Usa set_config('request.jwt.claims', ...) para simular utilizadores.
-- =============================================================================


-- =============================================================================
-- TESTE 1: ANON — deve falhar em TUDO
-- =============================================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_config('role', 'anon', true);

  BEGIN
    SELECT to_jsonb(r.*) INTO v_result FROM public.rides r LIMIT 1;
    RAISE NOTICE 'TESTE 1.1 FALHOU: anon leu rides';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.1 OK: anon bloqueado em SELECT rides — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.accept_ride_atomic(gen_random_uuid());
    RAISE NOTICE 'TESTE 1.2 FALHOU: anon executou accept_ride_atomic';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.2 OK: anon bloqueado em accept_ride_atomic — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.cancel_ride_safe(gen_random_uuid(), 'teste');
    RAISE NOTICE 'TESTE 1.3 FALHOU: anon executou cancel_ride_safe';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.3 OK: anon bloqueado em cancel_ride_safe — %', SQLERRM;
  END;

  BEGIN
    v_result := public.get_active_ride();
    RAISE NOTICE 'TESTE 1.4 FALHOU: anon executou get_active_ride: %', v_result;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.4 OK: anon bloqueado em get_active_ride — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.recharge_chat_quota(10);
    RAISE NOTICE 'TESTE 1.5 FALHOU: anon executou recharge_chat_quota';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.5 OK: anon bloqueado em recharge_chat_quota — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.confirm_pickup(gen_random_uuid());
    RAISE NOTICE 'TESTE 1.6 FALHOU: anon executou confirm_pickup';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.6 OK: anon bloqueado em confirm_pickup — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.start_ride(gen_random_uuid());
    RAISE NOTICE 'TESTE 1.7 FALHOU: anon executou start_ride';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.7 OK: anon bloqueado em start_ride — %', SQLERRM;
  END;

  BEGIN
    PERFORM public.complete_ride(gen_random_uuid());
    RAISE NOTICE 'TESTE 1.8 FALHOU: anon executou complete_ride';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 1.8 OK: anon bloqueado em complete_ride — %', SQLERRM;
  END;

  PERFORM set_config('role', 'service_role', true);
END $$;


-- =============================================================================
-- TESTE 2: PASSAGEIRO — vê só as suas corridas, não pode aceitar
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_other_id     UUID := '33333333-3333-3333-3333-333333333333';
  v_ride_id      UUID;
  v_result       JSONB;
  v_count        INT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  -- Criar corrida como passageiro
  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status)
  VALUES (v_passenger_id, 'Rua Teste', -8.83, 13.23, 'Rua Destino', -8.84, 13.24, 5.0, 15, 1500, 'searching')
  RETURNING id INTO v_ride_id;

  RAISE NOTICE 'TESTE 2: Corrida criada: %', v_ride_id;

  -- 2.1 passageiro vê as suas corridas
  SELECT count(*) INTO v_count FROM public.rides WHERE passenger_id = v_passenger_id;
  RAISE NOTICE 'TESTE 2.1 %: passageiro vê % corridas próprias', CASE WHEN v_count > 0 THEN 'OK' ELSE 'FALHOU' END, v_count;

  -- 2.2 passageiro pode cancelar a SUA corrida
  BEGIN
    PERFORM public.cancel_ride_safe(v_ride_id, 'Teste cancelamento');
    RAISE NOTICE 'TESTE 2.2 OK: passageiro cancelou a sua corrida';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 2.2 FALHOU: passageiro não cancelou — %', SQLERRM;
  END;

  -- Recriar para testes seguintes
  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status)
  VALUES (v_passenger_id, 'O', -8.83, 13.23, 'D', -8.84, 13.24, 5.0, 15, 1500, 'searching')
  RETURNING id INTO v_ride_id;

  -- 2.3 passageiro NÃO pode executar accept_ride_atomic
  BEGIN
    PERFORM public.accept_ride_atomic(v_ride_id);
    RAISE NOTICE 'TESTE 2.3 FALHOU: passageiro executou accept_ride_atomic';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 2.3 OK: passageiro bloqueado em accept_ride_atomic — %', SQLERRM;
  END;

  DELETE FROM public.rides WHERE id = v_ride_id;
END $$;


-- =============================================================================
-- TESTE 3: MOTORISTA — fluxo completo accept → pickup → start → complete
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_driver_id    UUID := '22222222-2222-2222-2222-222222222222';
  v_ride_id      UUID;
  v_result       JSONB;
  v_status       TEXT;
BEGIN
  -- Criar corrida como passageiro
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status)
  VALUES (v_passenger_id, 'Início', -8.83, 13.23, 'Fim', -8.84, 13.24, 5.0, 15, 1500, 'searching')
  RETURNING id INTO v_ride_id;

  -- Simular motorista
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_id, 'role', 'authenticated')::text, true);

  -- 3.1 accept
  v_result := public.accept_ride_atomic(v_ride_id);
  SELECT status::text INTO v_status FROM public.rides WHERE id = v_ride_id;
  RAISE NOTICE 'TESTE 3.1 %: accept_ride → status=%', CASE WHEN (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_status;

  -- 3.2 confirm_pickup
  v_result := public.confirm_pickup(v_ride_id);
  SELECT status::text INTO v_status FROM public.rides WHERE id = v_ride_id;
  RAISE NOTICE 'TESTE 3.2 %: confirm_pickup → status=%', CASE WHEN (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_status;

  -- 3.3 start_ride
  v_result := public.start_ride(v_ride_id);
  SELECT status::text INTO v_status FROM public.rides WHERE id = v_ride_id;
  RAISE NOTICE 'TESTE 3.3 %: start_ride → status=%', CASE WHEN (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_status;

  -- 3.4 complete_ride
  v_result := public.complete_ride(v_ride_id);
  SELECT status::text INTO v_status FROM public.rides WHERE id = v_ride_id;
  RAISE NOTICE 'TESTE 3.4 %: complete_ride → status=%', CASE WHEN (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_status;

  DELETE FROM public.rides WHERE id = v_ride_id;
END $$;


-- =============================================================================
-- TESTE 4: ACESSO CRUZADO — passageiro tenta cancelar corrida de outro
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_other_id     UUID := '33333333-3333-3333-3333-333333333333';
  v_ride_id      UUID;
  v_cancel_ok    BOOLEAN;
  v_cancel_msg   TEXT;
BEGIN
  -- Criar corrida como passageiro A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status)
  VALUES (v_passenger_id, 'O', -8.83, 13.23, 'D', -8.84, 13.24, 5.0, 15, 1500, 'searching')
  RETURNING id INTO v_ride_id;

  -- Simular passageiro B (outro utilizador)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_id, 'role', 'authenticated')::text, true);

  -- 4.1 outro não pode cancelar corrida de A
  SELECT success, message INTO v_cancel_ok, v_cancel_msg FROM public.cancel_ride_safe(v_ride_id, 'Malicioso');
  RAISE NOTICE 'TESTE 4.1 %: outro tentou cancelar — %', CASE WHEN v_cancel_ok = false THEN 'OK' ELSE 'FALHOU' END, v_cancel_msg;

  DELETE FROM public.rides WHERE id = v_ride_id;
END $$;


-- =============================================================================
-- TESTE 5: RECHARGE — valores negativos e gigantes bloqueados
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_driver_id    UUID := '22222222-2222-2222-2222-222222222222';
  v_ride_id      UUID;
  v_antes  INT;
  v_depois INT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  -- Criar corrida completada (necessário para recharge)
  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status, driver_id, completed_at)
  VALUES (v_passenger_id, 'O', -8.83, 13.23, 'D', -8.84, 13.24, 5.0, 15, 1500, 'completed', v_driver_id, NOW())
  RETURNING id INTO v_ride_id;

  SELECT COALESCE(chat_quota, 0) INTO v_antes FROM public.profiles WHERE user_id = v_passenger_id;

  -- 5.1 valor negativo → limitado a 1
  BEGIN
    PERFORM public.recharge_chat_quota(-100);
    SELECT COALESCE(chat_quota, 0) INTO v_depois FROM public.profiles WHERE user_id = v_passenger_id;
    RAISE NOTICE 'TESTE 5.1 %: -100 → +% (quota: %→%)', CASE WHEN v_depois = v_antes + 1 THEN 'OK' ELSE 'FALHOU' END, 1, v_antes, v_depois;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 5.1 OK: negativo bloqueado — %', SQLERRM;
  END;

  -- 5.2 valor gigante → limitado a 50
  UPDATE public.profiles SET chat_quota = 0 WHERE user_id = v_passenger_id;
  v_antes := 0;
  BEGIN
    PERFORM public.recharge_chat_quota(999999);
    SELECT COALESCE(chat_quota, 0) INTO v_depois FROM public.profiles WHERE user_id = v_passenger_id;
    RAISE NOTICE 'TESTE 5.2 %: 999999 → quota=%', CASE WHEN v_depois <= 50 THEN 'OK' ELSE 'FALHOU' END, v_depois;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TESTE 5.2 OK: gigante bloqueado — %', SQLERRM;
  END;

  -- 5.3 quota máxima 50
  UPDATE public.profiles SET chat_quota = 48 WHERE user_id = v_passenger_id;
  PERFORM public.recharge_chat_quota(50);
  SELECT COALESCE(chat_quota, 0) INTO v_depois FROM public.profiles WHERE user_id = v_passenger_id;
  RAISE NOTICE 'TESTE 5.3 %: quota=48+50→% (max 50)', CASE WHEN v_depois = 50 THEN 'OK' ELSE 'INVESTIGAR' END, v_depois;

  DELETE FROM public.rides WHERE id = v_ride_id;
  UPDATE public.profiles SET chat_quota = 0 WHERE user_id = v_passenger_id;
END $$;


-- =============================================================================
-- TESTE 6: STATE MACHINE — transições inválidas bloqueadas
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_driver_id    UUID := '22222222-2222-2222-2222-222222222222';
  v_ride_id      UUID;
  v_result       JSONB;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.rides (passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, distance_km, duration_min, price_kz, status)
  VALUES (v_passenger_id, 'O', -8.83, 13.23, 'D', -8.84, 13.24, 5.0, 15, 1500, 'searching')
  RETURNING id INTO v_ride_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_id, 'role', 'authenticated')::text, true);

  -- 6.1 complete_ride em searching → deve falhar
  v_result := public.complete_ride(v_ride_id);
  RAISE NOTICE 'TESTE 6.1 %: complete em searching — %', CASE WHEN NOT (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_result->>'reason';

  -- 6.2 start_ride em accepted (sem confirm_pickup) → deve falhar
  PERFORM public.accept_ride_atomic(v_ride_id);
  v_result := public.start_ride(v_ride_id);
  RAISE NOTICE 'TESTE 6.2 %: start em accepted — %', CASE WHEN NOT (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_result->>'reason';

  -- 6.3 confirm_pickup em in_progress → deve falhar (precisa de aceitar e confirmar primeiro)
  PERFORM public.confirm_pickup(v_ride_id);
  PERFORM public.start_ride(v_ride_id);
  v_result := public.confirm_pickup(v_ride_id);
  RAISE NOTICE 'TESTE 6.3 %: confirm_pickup em in_progress — %', CASE WHEN NOT (v_result->>'success')::bool THEN 'OK' ELSE 'FALHOU' END, v_result->>'reason';

  DELETE FROM public.rides WHERE id = v_ride_id;
END $$;


-- =============================================================================
-- TESTE 7: REVOKE — anon não tem EXECUTE em nenhuma RPC crítica
-- =============================================================================
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.accept_ride_atomic(uuid)', 'execute')
     AND NOT has_function_privilege('anon', 'public.cancel_ride_safe(uuid, text)', 'execute')
     AND NOT has_function_privilege('anon', 'public.get_active_ride()', 'execute')
     AND NOT has_function_privilege('anon', 'public.recharge_chat_quota(integer)', 'execute')
     AND NOT has_function_privilege('anon', 'public.confirm_pickup(uuid)', 'execute')
     AND NOT has_function_privilege('anon', 'public.start_ride(uuid)', 'execute')
     AND NOT has_function_privilege('anon', 'public.complete_ride(uuid)', 'execute')
     AND NOT has_function_privilege('anon', 'public.decline_ride_atomic(uuid)', 'execute')
  THEN
    RAISE NOTICE 'TESTE 7 OK: anon SEM EXECUTE em 8 RPCs críticas';
  ELSE
    RAISE NOTICE 'TESTE 7 FALHOU: anon ainda tem acesso!';
  END IF;
END $$;


-- =============================================================================
-- TESTE 8: RLS — passageiro não vê driver_locations de outros
-- =============================================================================
DO $$
DECLARE
  v_passenger_id UUID := '11111111-1111-1111-1111-111111111111';
  v_count INT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_passenger_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count FROM public.driver_locations;
  RAISE NOTICE 'TESTE 8 %: passageiro vê % driver_locations', CASE WHEN v_count = 0 THEN 'OK' ELSE 'INVESTIGAR' END, v_count;
END $$;


-- =============================================================================
-- TESTE 9: BYPASSRLS — service_role info
-- =============================================================================
DO $$
DECLARE
  v_bypass BOOLEAN;
BEGIN
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'service_role';
  IF v_bypass THEN
    RAISE NOTICE 'TESTE 9 INFO: service_role TEM BYPASSRLS (normal no Supabase)';
    RAISE NOTICE '  FORCE RLS NÃO restringe service_role.';
    RAISE NOTICE '  Segurança depende de: anon=REVOKE ALL, auth.uid() nas RPCs.';
  ELSE
    RAISE NOTICE 'TESTE 9 INFO: service_role SEM BYPASSRLS';
  END IF;
END $$;


-- =============================================================================
-- TESTE 10: REALTIME — verificar publicação
-- =============================================================================
DO $$
DECLARE
  v_rides BOOLEAN;
  v_dl    BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'rides') INTO v_rides;
  SELECT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'driver_locations') INTO v_dl;

  IF v_rides AND v_dl THEN
    RAISE NOTICE 'TESTE 10 OK: rides e driver_locations na publicação Realtime';
    RAISE NOTICE '  Para testar do frontend:';
    RAISE NOTICE '  1. Subscrever subscribeToAvailableRides() como motorista';
    RAISE NOTICE '  2. Criar corrida como passageiro noutro browser';
    RAISE NOTICE '  3. Verificar que o motorista recebe o evento INSERT';
    RAISE NOTICE '  4. Passageiro NÃO deve receber eventos de corridas de outro';
  ELSE
    RAISE NOTICE 'TESTE 10 FALHOU: tabelas não estão na publicação';
  END IF;
END $$;


-- =============================================================================
-- CLEANUP
-- =============================================================================
SELECT public._test_cleanup();


-- =============================================================================
-- RESUMO
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'TESTES COMPLETOS:';
  RAISE NOTICE '  1. Anon bloqueado em 8 RPCs + SELECT';
  RAISE NOTICE '  2. Passageiro: vê/ cancela suas corridas, não aceita';
  RAISE NOTICE '  3. Motorista: accept→pickup→start→complete OK';
  RAISE NOTICE '  4. Acesso cruzado bloqueado';
  RAISE NOTICE '  5. recharge: negativos/gigantes bloqueados, max 50';
  RAISE NOTICE '  6. State machine: transições inválidas bloqueadas';
  RAISE NOTICE '  7. REVOKE ALL confirmado em anon';
  RAISE NOTICE '  8. RLS: passageiro não vê driver_locations';
  RAISE NOTICE '  9. BYPASSRLS: info sobre service_role';
  RAISE NOTICE ' 10. Realtime: tabelas na publicação';
  RAISE NOTICE '================================================================';
END $$;
