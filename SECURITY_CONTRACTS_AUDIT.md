# 🔐 Auditoria de Segurança — Zona de Contratos
## MotoGo AI v2.1

---

## 1. Contexto

A tabela `contracts` armazena contratos recorrentes (school/work) com:
- Dados de localização (`dest_lat`, `dest_lng`)
- Horários (`time_start`, `time_end`)
- Flag sensível (`parent_monitoring`)
- Métricas do sistema (`km_accumulated`, `bonus_kz`)
- Flag `active`

RLS está activado. A tabela **não** está publicada no Supabase Realtime (correcto).

---

## 2. Vulnerabilidades Identificadas

### 🔴 CRÍTICA — UPDATE sem WITH CHECK (user_id transferível)

**Problema:**
```sql
-- Policy original
CREATE POLICY "contracts: editar" ON public.contracts
  FOR UPDATE USING (auth.uid() = user_id);
-- ⚠️ Sem WITH CHECK
```

`USING` controla *quais linhas* podem ser alvo do UPDATE (condição WHERE implícita).  
`WITH CHECK` controla *o que pode ser escrito* nos dados novos.

Sem `WITH CHECK`, um utilizador podia fazer:
```sql
UPDATE contracts SET user_id = '<outro-uuid>' WHERE id = '<meu-contrato>';
```
→ Transferir o contrato para outra conta, potencialmente tomando dados alheios.

**Fix aplicado (schema.sql PATCH):**
```sql
CREATE POLICY "contracts: editar" ON public.contracts
  FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);  -- ← adicionado
```

---

### 🔴 ALTA — km_accumulated e bonus_kz editáveis directamente

**Problema:**  
Estes campos são **métricas do sistema** (calculadas por corridas concluídas), mas a policy UPDATE genérica permite que qualquer utilizador os altere via:
```javascript
supabase.from('contracts').update({ km_accumulated: 99999, bonus_kz: 50000 }).eq('id', '...')
```

**Fix aplicado (schema.sql PATCH):**  
Trigger `t_contracts_protect_system_fields` que lança exceção se `km_accumulated` ou `bonus_kz` forem alterados via UPDATE directo.

```sql
-- Bloqueia qualquer tentativa de alterar campos protegidos
IF NEW.km_accumulated IS DISTINCT FROM OLD.km_accumulated THEN
  RAISE EXCEPTION 'km_accumulated é gerido pelo sistema...';
END IF;
```

> ⚠️ Nota: Para o sistema actualizar `km_accumulated` no futuro, deverá usar uma função SQL `SECURITY DEFINER` que faça `SET LOCAL session_replication_role = 'replica'` antes do UPDATE, ou uma RPC dedicada.

---

### 🟡 MÉDIA — Sem policy DELETE

**Problema:**  
O utilizador não consegue apagar os seus próprios contratos. Dependendo do design, pode ser intencional. Mas também não existe policy de admin para limpeza.

**Fix (já aplicado em patch_01_security.sql):**
```sql
CREATE POLICY "contracts: eliminar próprio"
ON public.contracts FOR DELETE
USING (auth.uid() = user_id);
```

---

### 🟡 MÉDIA — Sem validação de coordenadas ao nível da BD

**Problema:**  
`dest_lat` e `dest_lng` não têm CHECK constraints. Um utilizador podia inserir coordenadas fora de Angola (ou coordenadas absurdas como `lat: 999`).

**Fix (já aplicado em patch_01_security.sql):**
```sql
CREATE OR REPLACE FUNCTION validate_contract_coords()
RETURNS TRIGGER AS $$
BEGIN
  -- Angola: lat -18 a -4, lng 11 a 25
  IF NEW.dest_lat < -18.0 OR NEW.dest_lat > -4.0 OR
     NEW.dest_lng < 11.0  OR NEW.dest_lng > 25.0 THEN
    RAISE EXCEPTION 'Coordenadas fora de Angola';
  END IF;
  IF NEW.time_start >= NEW.time_end THEN
    RAISE EXCEPTION 'Hora de início deve ser anterior à hora de fim.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

### 🟡 MÉDIA — parent_monitoring editável sem restrição

**Problema:**  
A flag `parent_monitoring` tem implicações de segurança (monitorização de menores). Qualquer utilizador pode activar/desactivar sem validação adicional.

**Recomendação:**  
Mover para campos controlados via RPC dedicada:
```sql
CREATE OR REPLACE FUNCTION toggle_parent_monitoring(p_contract_id UUID, p_value BOOLEAN)
RETURNS void AS $$
BEGIN
  UPDATE contracts SET parent_monitoring = p_value
  WHERE id = p_contract_id AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
Permitiria logging/auditoria desta acção específica.

**Status:** Recomendação documentada. Não implementado (fora do âmbito mínimo).

---

### 🟢 BAIXA — Sem índice em user_id

**Problema:**  
Queries `WHERE user_id = auth.uid()` fazem seq scan em tabela grande.

**Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_contracts_user_id
  ON public.contracts(user_id, active, created_at DESC);
```

**Status:** Recomendação. Implementar quando a tabela tiver >1000 registos.

---

### 🟢 BAIXA — Sem auditoria de alterações

**Problema:**  
Não existe log de quem alterou o quê e quando nos contratos.

**Recomendação futura:**
```sql
CREATE TABLE public.contract_audit_log (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id UUID REFERENCES contracts(id),
  user_id     UUID REFERENCES users(id),
  action      TEXT, -- INSERT/UPDATE/DELETE
  old_data    JSONB,
  new_data    JSONB,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);
```
Implementar via trigger `AFTER INSERT OR UPDATE OR DELETE`.

---

## 3. O que está correcto (não alterar)

| Item | Estado |
|---|---|
| RLS activado na tabela | ✅ |
| SELECT restrito ao próprio utilizador | ✅ |
| INSERT validado com `auth.uid() = user_id` | ✅ |
| `contract_type` com CHECK constraint (`school`/`work`) | ✅ |
| Tabela **não** exposta no Realtime | ✅ |
| Relação `user_id → users(id)` com ON DELETE CASCADE | ✅ |
| `active` flag controlável pelo utilizador (intencional) | ✅ |

---

## 4. Resumo das Patches Aplicadas

| Vulnerabilidade | Ficheiro | Status |
|---|---|---|
| UPDATE sem WITH CHECK (user_id transferível) | `schema.sql` PATCH | ✅ Corrigido |
| km_accumulated/bonus_kz editáveis | `schema.sql` PATCH | ✅ Corrigido (trigger) |
| Sem policy DELETE | `patch_01_security.sql` | ✅ Corrigido |
| Sem validação de coordenadas | `patch_01_security.sql` | ✅ Corrigido (trigger) |
| parent_monitoring sem logging | — | 📋 Recomendação |
| Sem índice em user_id | — | 📋 Recomendação |
| Sem auditoria de alterações | — | 📋 Recomendação futura |

---

*Auditoria realizada em 25/03/2026 — MotoGo AI v2.1*
