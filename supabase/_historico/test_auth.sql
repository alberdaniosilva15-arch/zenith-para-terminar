BEGIN;
DO $$
DECLARE
    v_passenger_id UUID := '23d26ae6-8597-4add-9e29-ecc7c527850d';
    v_driver_id UUID := 'e8a10e95-31bb-4faf-bd56-038976223bf0';
    v_other_driver_id UUID := 'ebb92f1e-9119-4bc0-ae21-c83ab37d021d';
    v_count INT;
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE ' 🟢 TESTE 1: LOGADO COMO MOTORISTA';
    RAISE NOTICE '==================================================';
    EXECUTE 'SET LOCAL role = ''authenticated''';
    EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub": "' || v_driver_id || '", "role": "authenticated"}''';
    
    SELECT COUNT(*) INTO v_count FROM public.driver_locations;
    IF v_count = 1 THEN RAISE NOTICE '✅ SUCESSO: Motorista leu so 1 GPS (o dele).';
    ELSE RAISE WARNING '🚨 VAZAMENTO: Leu % linhas.', v_count; END IF;

    UPDATE public.driver_locations SET status = 'busy' WHERE driver_id = v_other_driver_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN RAISE NOTICE '✅ SUCESSO: Bloqueada tentativa de update alheio.';
    ELSE RAISE WARNING '🚨 VAZAMENTO: Alterou % linhas alheias.', v_count; END IF;

    RAISE NOTICE '==================================================';
    RAISE NOTICE ' 🟢 TESTE 2: LOGADO COMO PASSAGEIRO';
    RAISE NOTICE '==================================================';
    EXECUTE 'SET LOCAL role = ''authenticated''';
    EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub": "' || v_passenger_id || '", "role": "authenticated"}''';

    SELECT COUNT(*) INTO v_count FROM public.driver_locations;
    IF v_count = 0 THEN RAISE NOTICE '✅ SUCESSO: Passageiro bloqueado na leitura de GPS directo.';
    ELSE RAISE WARNING '🚨 BRECHA: Leu % GPS.', v_count; END IF;

    SELECT COUNT(*) INTO v_count FROM public.rides;
    IF v_count = 0 THEN RAISE NOTICE '✅ SUCESSO: Passageiro bloqueado na leitura das faturas.';
    ELSE RAISE WARNING '🚨 BRECHA: Leu % faturas alheias.', v_count; END IF;
END $$;
ROLLBACK;
