-- =============================================================================
-- CRIAÇÃO DE CONTAS: AUTO-CONFIRMAÇÃO (BYPASS WAITING FOR VERIFICATION)
-- =============================================================================

-- Criação do trigger para auto-confirmar emails
CREATE OR REPLACE FUNCTION public.auto_confirm_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Auto-confirma qualquer novo user criado (anula o "waiting for verification")
  UPDATE auth.users 
  SET email_confirmed_at = NOW() 
  WHERE email_confirmed_at IS NULL AND id = NEW.id;
  RETURN NEW;
END;
$$;

-- Vincular o trigger
DROP TRIGGER IF EXISTS on_auth_user_created_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_confirm
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.auto_confirm_users();

SELECT 'Trigger de Auto-Confirmação Criado sem hardcodeds. Podes criar as contas na App e já entram directo!' AS aviso;
