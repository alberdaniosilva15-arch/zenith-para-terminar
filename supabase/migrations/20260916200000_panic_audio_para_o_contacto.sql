-- =============================================================================
-- ZENITH RIDE — o áudio do grito tem de chegar ao contacto de emergência
-- =============================================================================
-- Data: 2026-09-16
--
-- O PROBLEMA (Fase 5)
-- ─────────────────────────────────────────────────────────────────────────────
-- O `screamDetector.ts` detecta o grito (amplitude) e o wake-word "socorro"
-- (reconhecimento de voz). O `PanicButton` reage gravando 30 segundos de áudio
-- e guardando-o no bucket privado `panic-audio`, com o caminho em
-- `panic_alerts.audio_storage_path`.
--
-- E depois... nada. O contacto de emergência recebe um SMS de TEXTO
-- (`buildEmergencyMessage`) e, se for de noite, uma chamada. O áudio — que é a
-- única prova real do que se está a passar — fica parado no storage. Ninguém
-- o ouve, porque:
--   • o bucket é PRIVADO (`public = false`), logo um URL directo não abre;
--   • o SMS sai do telemóvel do passageiro e não sabe gerar links assinados;
--   • ninguém está a olhar para o alerta do lado do servidor.
--
-- A CORRECÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
-- O Postgres guarda o ESTADO do aviso ao contacto; quem pensa é o Edge Function
-- `sos-escalation`, que já corre a cada minuto e já sabe enviar WhatsApp. Uma
-- passagem nova do motor trata dos alertas de pânico:
--
--   alerta crítico criado
--        └─> (espera o áudio ficar gravado e carregado)
--              └─> gera link ASSINADO do áudio
--                    └─> WhatsApp ao contacto com localização + link
--                          └─> marca contact_notified_at
--
-- Estas colunas são esse estado:
--   • contact_phone        — retrato do número no momento do alerta. O perfil
--                            pode mudar depois; o que interessa é para quem se
--                            ligou naquela noite.
--   • contact_notified_at  — quando o WhatsApp saiu. NULL = ainda por avisar.
--   • contact_attempts     — tentativas. Impede um ciclo infinito se o número
--                            estiver errado: ao fim de 3, desiste e deixa nota.
--   • contact_last_error   — porquê falhou, para o admin poder ver.
-- =============================================================================

ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS contact_phone       TEXT,
  ADD COLUMN IF NOT EXISTS contact_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_attempts    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_last_error  TEXT;

COMMENT ON COLUMN public.panic_alerts.contact_phone IS
  'Número do contacto de emergência no momento do alerta (retrato, não referência).';
COMMENT ON COLUMN public.panic_alerts.contact_notified_at IS
  'Quando o WhatsApp com o áudio saiu para o contacto. NULL = por avisar.';
COMMENT ON COLUMN public.panic_alerts.contact_attempts IS
  'Tentativas de aviso ao contacto. Máximo 3 — evita ciclo infinito com número errado.';

-- Índice para a consulta do motor: "alertas ainda por avisar, recentes".
-- Parcial porque a esmagadora maioria dos alertas já estará avisada e não
-- interessa varrê-los todos a cada minuto.
CREATE INDEX IF NOT EXISTS idx_panic_alerts_por_avisar
  ON public.panic_alerts (created_at DESC)
  WHERE contact_notified_at IS NULL;
