-- Remover politicas abertas anon_all
DROP POLICY IF EXISTS "anon_all" ON message_dedup;
DROP POLICY IF EXISTS "anon_all" ON rate_limit_log;
DROP POLICY IF EXISTS "anon_all" ON conversation_memory;
DROP POLICY IF EXISTS "anon_all" ON user_profiles;
DROP POLICY IF EXISTS "anon_all" ON elevenlabs_usage;

-- Criar politicas seguras para service_role
CREATE POLICY "service_role_all" ON message_dedup FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON rate_limit_log FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON conversation_memory FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON user_profiles FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON elevenlabs_usage FOR ALL TO service_role USING (true);
