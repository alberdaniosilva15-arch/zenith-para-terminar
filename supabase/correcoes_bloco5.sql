-- ═══════════════════════════════════════════════════════════════
-- CORREÇÕES BLOCO 5: Supabase Cron Jobs
-- Zenith Ride v4.0 — 2026-05-05
-- ═══════════════════════════════════════════════════════════════

-- AVISO: A execução de extensões e agendamentos cron requer
-- permissões de superadmin no Supabase (geralmente feito na Cloud UI)

-- 1. Activar a extensão pg_cron (caso ainda não esteja)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net; -- Necessário para apagar ficheiros no storage via API

-- ═══════════════════════════════════════════════════════════════
-- 2. LIMPEZA DE ÁUDIO DO BUCKET (Após 7 dias)
-- ═══════════════════════════════════════════════════════════════
-- Como o Storage não tem TTL nativo, criamos uma função para apagar via Edge Function 
-- ou via DELETE directo aos objectos do storage se tivermos acesso à bd storage.

CREATE OR REPLACE FUNCTION public.delete_old_panic_audio()
RETURNS void AS $$
BEGIN
  -- Apaga os registos da tabela `storage.objects` que estejam no bucket 'panic-audio'
  -- e tenham sido criados há mais de 7 dias. (Isto remove fisicamente os ficheiros no Supabase).
  DELETE FROM storage.objects
  WHERE bucket_id = 'panic-audio'
    AND created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Agendar para correr todos os dias às 03:00 AM
SELECT cron.schedule('limpeza_diaria_audio', '0 3 * * *', 'SELECT public.delete_old_panic_audio();');


-- ═══════════════════════════════════════════════════════════════
-- 3. BÓNUS TOP 3 MOTORISTAS DE CONTRATO (15%)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.distribute_contract_bonus()
RETURNS void AS $$
DECLARE
  total_contract_revenue NUMERIC;
  bonus_pool NUMERIC;
  driver_rec RECORD;
  rank_num INT := 1;
  bonus_pct NUMERIC;
  payout NUMERIC;
BEGIN
  -- 1. Calcular a faturação total de contratos do mês transacto
  SELECT COALESCE(SUM(fare_kz), 0) INTO total_contract_revenue
  FROM rides
  WHERE contract_id IS NOT NULL
    AND status = 'COMPLETED'
    AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
    AND created_at < date_trunc('month', NOW());

  -- 2. Pool de bónus é 15% desse total
  bonus_pool := total_contract_revenue * 0.15;
  IF bonus_pool <= 0 THEN
    RETURN; -- Sem lucro, sem bónus
  END IF;

  -- 3. Encontrar os Top 3 motoristas com mais viagens de contrato nesse período
  FOR driver_rec IN (
    SELECT driver_id, COUNT(id) as ride_count
    FROM rides
    WHERE contract_id IS NOT NULL
      AND status = 'COMPLETED'
      AND driver_id IS NOT NULL
      AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
      AND created_at < date_trunc('month', NOW())
    GROUP BY driver_id
    ORDER BY ride_count DESC
    LIMIT 3
  ) LOOP
    -- Distribuição do pool: 1º (50%), 2º (30%), 3º (20%) dos 15%
    IF rank_num = 1 THEN bonus_pct := 0.50;
    ELSIF rank_num = 2 THEN bonus_pct := 0.30;
    ELSIF rank_num = 3 THEN bonus_pct := 0.20;
    END IF;

    payout := bonus_pool * bonus_pct;

    -- Depositar na wallet do motorista (inserindo uma transaction)
    INSERT INTO transactions (user_id, amount_kz, type, status, description)
    VALUES (
      driver_rec.driver_id, 
      payout, 
      'BONUS', 
      'COMPLETED', 
      'Bónus Top 3 Contratos do mês anterior'
    );

    rank_num := rank_num + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Agendar para correr no dia 1 de cada mês à 01:00 AM
SELECT cron.schedule('bonus_mensal_contratos', '0 1 1 * *', 'SELECT public.distribute_contract_bonus();');

-- ═══════════════════════════════════════════════════════════════
-- FIM — Cola no SQL Editor do Supabase e executa
-- ═══════════════════════════════════════════════════════════════
