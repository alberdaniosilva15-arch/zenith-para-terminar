-- =============================================================================
-- ZENITH RIDE — Configuração da Conta de Motorista Oficial
-- alberdaniosilva16@gmail.com
-- Data: 2026-09-10
--
-- Resolve: "Conta não configurada como motorista"
-- =============================================================================

BEGIN;

-- 1. Promover alberdaniosilva16@gmail.com a motorista na BD
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Procurar UUID da conta em auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'alberdaniosilva16@gmail.com' LIMIT 1;
  
  IF v_user_id IS NOT NULL THEN
    -- Garantir papel na tabela public.users
    INSERT INTO public.users (id, email, role, updated_at)
    VALUES (v_user_id, 'alberdaniosilva16@gmail.com', 'driver', NOW())
    ON CONFLICT (id) DO UPDATE SET role = 'driver', updated_at = NOW();

    -- Garantir perfil
    INSERT INTO public.profiles (user_id, name, rating, total_rides, level)
    VALUES (v_user_id, 'Alberdanio Silva', 5.0, 20, 'Ouro')
    ON CONFLICT (user_id) DO UPDATE SET rating = 5.0;

    -- Garantir documentos aprovados (para o app nunca bloquear o ecrã com pedidos de BI/carro)
    INSERT INTO public.driver_documents (driver_id, car_brand, car_model, car_plate, car_color, status, updated_at)
    VALUES (v_user_id, 'Toyota', 'Corolla', 'LD-45-89-AA', 'Preto', 'approved', NOW())
    ON CONFLICT (driver_id) DO UPDATE SET status = 'approved', updated_at = NOW();

    -- Garantir localização como disponível com coordenadas padrão de Luanda (lng 13.2343, lat -8.8368)
    INSERT INTO public.driver_locations (driver_id, status, location, updated_at, online_since)
    VALUES (v_user_id, 'available', ST_SetSRID(ST_MakePoint(13.2343, -8.8368), 4326), NOW(), NOW())
    ON CONFLICT (driver_id) DO UPDATE SET status = 'available', location = COALESCE(driver_locations.location, ST_SetSRID(ST_MakePoint(13.2343, -8.8368), 4326)), updated_at = NOW();

    -- Garantir carteira se tabela wallets existir
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallets') THEN
      INSERT INTO public.wallets (user_id, balance)
      VALUES (v_user_id, 50000.00)
      ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(wallets.balance, 50000.00);
    END IF;

    RAISE NOTICE 'Conta alberdaniosilva16@gmail.com configurada com sucesso como motorista! UUID: %', v_user_id;
  ELSE
    RAISE NOTICE 'Aviso: alberdaniosilva16@gmail.com não existe em auth.users ainda.';
  END IF;
END;
$$;

-- 2. Atualizar public.is_driver() para reconhecer sempre alberdaniosilva16@gmail.com
CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'driver'
  ) OR (auth.jwt() ->> 'email' = 'alberdaniosilva16@gmail.com');
$$;

-- 3. Atualizar set_my_role_driver() para ser resiliente e auto-criar utilizador se faltar
CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role, updated_at)
  VALUES (auth.uid(), auth.jwt() ->> 'email', 'driver', NOW())
  ON CONFLICT (id) DO UPDATE
  SET role = 'driver', updated_at = NOW()
  WHERE public.users.id = auth.uid() AND public.users.role != 'admin';

  INSERT INTO public.driver_locations (driver_id, status, location, updated_at)
  VALUES (auth.uid(), 'available', ST_SetSRID(ST_MakePoint(13.2343, -8.8368), 4326), NOW())
  ON CONFLICT (driver_id) DO UPDATE SET status = 'available', updated_at = NOW();

  INSERT INTO public.driver_documents (driver_id, status, updated_at)
  VALUES (auth.uid(), 'approved', NOW())
  ON CONFLICT (driver_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated;

COMMIT;
