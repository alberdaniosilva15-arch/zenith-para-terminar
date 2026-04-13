-- 20260413_fix_auth_trigger.sql
-- Este ficheiro corrige o erro crítico "Não foi possível finalizar o registo"
-- ao ligar a função handle_new_user() à tabela auth.users.

-- 1. Remoção por segurança (se já existir um com nome diferente ou bloqueado)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 2. Criação do Trigger que escuta todos os signups novos
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
