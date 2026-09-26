-- =============================================================================
-- ZENITH RIDE — `contracts.contract_type`: alinhar a BD com o que a app mostra
-- Escrita: 2026-09-26
--
-- ── O bug ────────────────────────────────────────────────────────────────────
--
-- Criar um contrato não-escolar rebentava com:
--
--   ERROR: new row for relation "contracts" violates check constraint
--          "contracts_contract_type_check"
--
-- A causa é haver TRÊS vocabulários diferentes para o mesmo campo:
--
--   • BD (constraint)         — 'school', 'work'
--   • UI (`ContractUi.tsx`)   — 'school', 'family', 'corporate'   ← o que o botão mostra
--   • tipos (`types.ts`)      — 'school', 'work', 'family', 'corporate'
--
-- O formulário envia o valor da UI ('family' / 'corporate'), a BD só aceitava
-- 'school' / 'work', logo **nunca** entrou um contrato que não fosse escolar.
-- Provado: `select contract_type, count(*) from contracts` → 15 linhas, todas
-- 'school'.
--
-- A tabela já tem as colunas para os três tipos (`company_name`, `company_nif`,
-- `monthly_budget`, `billing_email`, `contact_name`, `contact_phone`) — o
-- constraint é que ficou para trás, escrito antes de os tipos existirem. Não há
-- nenhuma migração no repo que o defina: foi criado à mão.
--
-- ── A correcção ──────────────────────────────────────────────────────────────
--
-- Alinhar com o UI (a fonte de verdade é o que o utilizador vê e escolhe) e
-- manter 'work' como legado tolerado: nenhuma linha o usa hoje, mas se alguma
-- vier a aparecer de um cliente antigo, não deve rebentar.
--
-- ── ⚠️ Nota sobre o cliente ───────────────────────────────────────────────────
--
-- `types.ts` declara `ContractType = 'school' | 'work' | 'family' | 'corporate'`
-- e `ContractUi.tsx` declara `'school' | 'family' | 'corporate'`. Ficam os dois a
-- funcionar com esta lista. Não se unifica os tipos aqui porque isso é uma
-- alteração de código, não de BD — mas fica o aviso.
-- =============================================================================

alter table public.contracts
  drop constraint if exists contracts_contract_type_check;

alter table public.contracts
  add constraint contracts_contract_type_check
  check (contract_type = any (array[
    'school',      -- Contrato Escolar      (o único que existia até hoje)
    'family',      -- Contrato Familiar
    'corporate',   -- Contrato Empresarial
    'work'         -- legado: sem uso, mas tolerado
  ]::text[]));

comment on constraint contracts_contract_type_check on public.contracts is
  'Valores alinhados com ContractUi.tsx (school/family/corporate) + work legado. '
  'Antes só aceitava school/work e bloqueava a criação de contratos familiares e '
  'empresariais — ver migração 20260926180000.';
