-- =============================================================================
-- Migration: 20260502_sentinel_automata
-- Adiciona campos para suportar a validacao de documentos com Sentinel IA.
-- =============================================================================

-- 1. Adicionar colunas em driver_documents
ALTER TABLE public.driver_documents 
ADD COLUMN IF NOT EXISTS has_ac BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_feedback TEXT;

-- 2. Expandir enum de status para permitir fallback humano, caso necessario.
-- No Supabase, se status for um enum, adicionar valor. Se for VARCHAR/TEXT, nao e preciso schema change.
-- A tabela driver_documents usa um campo de texto 'status' CHECK (status IN ('pending', 'approved', 'rejected', 'pending_human')) 
-- Vamos atualizar a constraint se ela existir.
DO $$
BEGIN
    ALTER TABLE public.driver_documents DROP CONSTRAINT IF EXISTS driver_documents_status_check;
    ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_status_check 
    CHECK (status IN ('pending', 'approved', 'rejected', 'pending_human'));
EXCEPTION
    WHEN undefined_object THEN
        -- Ignorar se a tabela for muito diferente, vamos manter os status como texto livre se der erro.
        NULL;
END $$;

-- 3. Tabela de registos de accoes do Sentinel (Event Logs)
CREATE TABLE IF NOT EXISTS public.ai_event_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_role TEXT NOT NULL, -- 'sentinel', 'kaze', 'ultron'
    action_type TEXT NOT NULL, -- 'approve_driver', 'reject_driver', 'ban_user'
    target_id TEXT, -- ID do motorista/passegeiro ou ride
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS para ai_event_logs
ALTER TABLE public.ai_event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins podem ver todos os event logs"
    ON public.ai_event_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- Apenas service role pode inserir
CREATE POLICY "Admins podem inserir logs"
    ON public.ai_event_logs FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );
