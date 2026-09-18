-- ════════════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Colunas em falta em `panic_alerts`
--
-- O painel SOS do admin (`src/components/admin/AdminSOSPanel.tsx`) e o tipo
-- `PanicAlertRecord` (`src/types.ts`) usam três colunas que NÃO existem na base
-- de dados ao vivo: `status`, `resolved_at` e `resolved_by`.
--
-- Consequências medidas, antes desta migration:
--   • `activeCount = alerts.filter(a => a.status === 'active')`  -> sempre 0.
--     O painel dizia "0 activos" com alertas de pânico à frente.
--   • `disabled={updatingId === alert.id || alert.status !== 'active'}`  ->
--     os botões "Resolver" e "Falso alarme" estavam SEMPRE desactivados.
--     `undefined !== 'active'` é verdadeiro, portanto nunca se podia clicar.
--   • Se se contornasse o `disabled`, o `update` rebentava com
--     `column panic_alerts.status does not exist`.
--
-- As políticas de RLS para isto já existiam (`panic_update_admin`), portanto o
-- arranjo é só alinhar o esquema com o que o código já espera.
--
-- A coluna `source` é nova e serve para o admin distinguir um SOS carregado no
-- botão de pânico de um aviso automático da escada de segurança (Fase 4).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'botao_panico';

-- Os alertas que já existiam foram criados pelo botão de pânico.
UPDATE public.panic_alerts
SET source = 'botao_panico'
WHERE source IS NULL OR source = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'panic_alerts_status_check'
  ) THEN
    ALTER TABLE public.panic_alerts
      ADD CONSTRAINT panic_alerts_status_check
      CHECK (status IN ('active', 'resolved', 'false_alarm'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'panic_alerts_source_check'
  ) THEN
    ALTER TABLE public.panic_alerts
      ADD CONSTRAINT panic_alerts_source_check
      CHECK (source IN ('botao_panico', 'escada_corrida', 'grito'));
  END IF;
END $$;

-- O painel ordena por `created_at` e filtra por `status`.
CREATE INDEX IF NOT EXISTS idx_panic_alerts_status_created
  ON public.panic_alerts(status, created_at DESC);

-- ── A escada de segurança precisa de LER a sua própria escada ────────────────
-- O `sos-escalation` corre como `service_role`, que ignora RLS. Mas o admin
-- também deve conseguir ver a escada de uma corrida no painel, e para isso a
-- política de leitura de `ride_safety_checks` já cobre `is_admin()`.
-- Nada a fazer aqui — fica registado para quem ler isto depois.
