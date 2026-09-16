# MIGRAÇÕES A SUBIR — Zenith Ride (checklist)

> Ordem de execução = ordem alfabética do nome do ficheiro.
> Pasta: `zenith-ride-build/supabase/migrations/`

---

## ✅ RESPOSTA CURTA

**Só tens 1 migração nova por subir:**

- [ ] `20260427180000_rename_motogopay_partners.sql`

Tudo o resto **já estava no projeto antes** desta sessão e assume-se já aplicado
à instância Supabase.

---

## Confirmado: a parte dos "scores" já estava feita

Já existia (e é anterior a esta sessão) a migração:

- [x] ~~`20260427170000_rename_motogo_score_to_zenith_score.sql`~~ → **já existia**

Essa é a migração que faz `motogo_scores` → `zenith_scores`, cria
`calculate_zenith_score()` e executa `DROP FUNCTION calculate_motogo_score(UUID)`.

Foi por isso que **não** criei uma nova migração para o `calculate_motogo_score`:
duplicar o rename seria redundante. Por isso é que o `zenith_score ?? motogo_score`
que ficou em `rideService.ts` é um fallback defensivo durante a transição — depois
de confirmares que a instância está migrada, esse fallback pode sair.

---

## A migração a subir (detalhe)

### [ ] 1. `20260427180000_rename_motogopay_partners.sql`

O que faz (idempotente — seguro re-executar):

1. `RENAME motogopay_partners → zenithpay_partners` (preserva dados/índices/policies)
2. `CREATE TABLE IF NOT EXISTS zenithpay_partners` (caso nenhuma exista)
3. Reconciliação de linhas por `id` (caso coexistam as duas)
4. Índice `idx_zenithpay_partners_active_category`
5. RLS: leitura de parceiros activos para `anon`/`authenticated`; escrita para admins
6. `GRANT SELECT` / `GRANT INSERT,UPDATE,DELETE`
7. View de compatibilidade `motogopay_partners` (só se a legada já não for tabela base)
8. `RAISE NOTICE` de validação final com a contagem de registos

**Depende de:** `public.is_admin_secure()` e `pgcrypto` (`gen_random_uuid`)
— ambos já existem na instância.

**Como subir** (escolhe uma):

- **Opção A — SQL Editor do Supabase:** abrir o ficheiro, copiar tudo, colar e correr.
- **Opção B — CLI:**
  ```bash
  supabase db push
  ```

**Como confirmar que correu bem:**
```sql
SELECT COUNT(*) FROM public.zenithpay_partners;
SELECT policyname FROM pg_policies WHERE tablename = 'zenithpay_partners';
```
Devem aparecer 2 policies: `zenithpay_partners_read_active` e
`zenithpay_partners_admin_write`.

---

## ⚠️ Não subir

- **Não** corras `rm -rf dist` nem limpares a pasta `dist/` antes do build — o
  safe-delete deste ambiente faz o `npm run build` falhar. Usa
  `npx vite build --outDir dist-verify`.
- A pasta `dist-verify/` (gerada na verificação) é descartável — podes apagá-la
  quando quiseres, não faz parte do projeto.

---

## Depois de subir a migração

- [ ] Testar a aba **Parceiros** na Carteira (`/wallet`) — a lista deve carregar
      de `zenithpay_partners`.
- [ ] Confirmar que `motogopay_partners` continua acessível (view) ou intacta.
