-- Função restrita para promover a driver se conta recém-criada via OAuth
CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Corrige vulnerabilidades: apenas 'passenger' criados há menos de 5 min podem ser promovidos
  IF EXISTS (
    SELECT 1 
    FROM public.users 
    WHERE id = auth.uid() 
    AND role = 'passenger'
    AND created_at > NOW() - INTERVAL '5 minutes'
  ) THEN
    UPDATE public.users SET role = 'driver' WHERE id = auth.uid();
  END IF;
END;
$$;
