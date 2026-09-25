-- =============================================================================
-- ZENITH RIDE — CONTRATOS PREMIUM + ZENITH PASS: colunas em falta
-- Escrita: 2026-09-25
--
-- ── Porquê esta migração existe ──────────────────────────────────────────────
--
-- O ecrã de Contratos estava a falhar por DOIS selects que pedem colunas que
-- nunca chegaram a existir na base de dados de produção:
--
--   src/components/Contract.tsx:49
--     from('contracts').select('*, monthly_credit_kz, credit_remaining_kz,
--                               discount_pct, payment_status')
--   src/components/Contract.tsx:50
--     from('profiles').select('km_total, free_km_available, km_to_next_perk,
--                              has_pass, pass_rides_remaining, pass_expires_at')
--
-- Ambos devolviam HTTP 400 (`42703: column ... does not exist`), pelo que a
-- lista de contratos não carregava. O `ZenithPassSection` também ESCREVE
-- has_pass / pass_rides_remaining / pass_expires_at ao activar o passe — esse
-- update falhava igualmente.
--
-- As definições já existiam, escritas a 05/05/2026 em
-- `supabase/_historico/bloco5_schema.sql` (Bloco 5 — Contratos Premium,
-- Multi-Stop, Pass, Business), mas esse ficheiro ficou arquivado e nunca foi
-- aplicado. Esta migração traz para produção a parte que o cliente já usa.
--
-- ── Âmbito ───────────────────────────────────────────────────────────────────
-- Incluído: os dois grupos de colunas que o código pede.
-- NÃO incluído (do mesmo Bloco 5, mas sem uso em `src/`): multi-stop em rides
-- (extra_passengers / extra_drop_*), business_accounts e business_employees.
-- Ficam para quando essas funcionalidades forem construídas — não vale a pena
-- criar tabelas que ninguém lê.
--
-- Tudo aditivo. Nada é apagado nem reescrito.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONTRATOS PREMIUM
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `discount_pct DEFAULT 25` e `payment_status DEFAULT 'pending'` coincidem com o
-- que o ContractCard assume quando o valor vem nulo
-- (`c.discount_pct ?? 25`, e o ramo 'pending' do selo).

alter table public.contracts
  add column if not exists monthly_credit_kz  numeric(12,2) default 0,
  add column if not exists credit_remaining_kz numeric(12,2) default 0,
  add column if not exists discount_pct        numeric(4,2)  default 25,
  add column if not exists billing_day         int           default 1,
  add column if not exists payment_status      text          default 'pending';

-- O CHECK é adicionado em separado para poder ser idempotente.
-- (Hoje é no-op: as 15 linhas existentes ficam todas com o DEFAULT 'pending'.)
do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname  = 'contracts_payment_status_check'
  ) then
    alter table public.contracts
      add constraint contracts_payment_status_check
      check (payment_status in ('active','expired','pending'));
  end if;
end
$chk$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ZENITH PASS (perfil do passageiro)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists has_pass             boolean     default false,
  add column if not exists pass_rides_remaining int         default 0,
  add column if not exists pass_expires_at      timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIM — recarregar a cache de schema do PostgREST
-- ─────────────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
