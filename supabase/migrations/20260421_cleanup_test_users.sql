-- =============================================================================
-- ZENITH RIDE — LIMPEZA DE CONTAS PROBLEMÁTICAS
-- Apaga os utilizadores de teste que estão bloqueados na UI do Supabase
-- SEGURO: idempotente, apaga dependências antes de apagar o auth.user
-- =============================================================================

DO $$
DECLARE
  v_uid UUID;
  emails_to_delete TEXT[] := ARRAY[
    'master_bypass@zenithride.com',
    'pass_test@gmail.com',
    'zenith_driver_test23@gmail.com',
    'alberdaniosilva21@gmail.com',
    'alberdaniosilva19@gamil.com',
    'alberdaniosilva22@gmail.com',
    'zenith_driver_test123@gmail.com'
  ];
  email_item TEXT;
BEGIN
  FOREACH email_item IN ARRAY emails_to_delete LOOP
    -- Obter o UID do utilizador
    SELECT id INTO v_uid FROM auth.users WHERE email = email_item;
    
    IF v_uid IS NULL THEN
      RAISE NOTICE 'Utilizador % não encontrado, a saltar.', email_item;
      CONTINUE;
    END IF;

    -- Apagar registos dependentes em ordem (FK constraints)
    DELETE FROM public.transactions       WHERE user_id = v_uid;
    DELETE FROM public.wallets            WHERE user_id = v_uid;
    DELETE FROM public.ride_predictions   WHERE user_id = v_uid;
    DELETE FROM public.driver_locations   WHERE driver_id = v_uid;
    DELETE FROM public.panic_alerts       WHERE user_id = v_uid;
    DELETE FROM public.referrals          WHERE referrer_id = v_uid OR referred_id = v_uid;
    DELETE FROM public.cash_advances      WHERE driver_id = v_uid;
    DELETE FROM public.driver_insurance   WHERE driver_id = v_uid;
    DELETE FROM public.posts              WHERE user_id = v_uid;
    
    -- Apagar corridas onde é passageiro ou motorista
    UPDATE public.rides SET driver_id = NULL WHERE driver_id = v_uid;
    DELETE FROM public.rides WHERE passenger_id = v_uid;
    
    -- Apagar contratos
    DELETE FROM public.contracts WHERE user_id = v_uid;
    
    -- Apagar o perfil e o user da app
    DELETE FROM public.profiles WHERE user_id = v_uid;
    DELETE FROM public.users    WHERE id = v_uid;
    
    -- Apagar o utilizador do auth (o auth.users em si)
    DELETE FROM auth.users WHERE id = v_uid;
    
    RAISE NOTICE '✅ Utilizador % (%) apagado com sucesso.', email_item, v_uid;
  END LOOP;
END $$;
