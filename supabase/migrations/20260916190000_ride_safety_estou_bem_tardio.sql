-- =============================================================================
-- ZENITH RIDE — ride_safety_checks: aceitar "estou bem" TARDIO
-- =============================================================================
-- Data: 2026-09-16
--
-- O PROBLEMA (encontrado ao construir o aviso in-app, não reportado por ninguém)
-- ─────────────────────────────────────────────────────────────────────────────
-- A escada abre a pergunta e dá 2 minutos para responder. Passados os 2 minutos,
-- o motor escala para o admin e, 10 minutos depois, manda WhatsApp ao contacto
-- de segurança do passageiro.
--
-- Mas `answer_ride_safety_check` recusava qualquer resposta quando o estado já
-- não era 'pergunta':
--
--     IF v_linha.estado <> 'pergunta' THEN
--       RETURN jsonb_build_object('ok', false, 'erro', 'ja_resolvido', ...);
--     END IF;
--
-- Consequência real: o passageiro está perfeitamente bem, mas não viu o aviso a
-- tempo (perdeu-o por segundos, tinha o telefone no bolso, estava a falar com o
-- motorista). Quando finalmente olha para o ecrã e carrega em "Estou bem", a
-- app recusa. A escada continua e o contacto de emergência recebe um alarme
-- falso — sobre uma pessoa que acabou de dizer, na própria app, que está bem.
--
-- Isto não é um detalhe de usabilidade. Alarme falso repetido treina o contacto
-- a ignorar o próximo aviso, e o próximo pode ser a sério. A escada TEM de
-- poder ser travada enquanto estiver aberta.
--
-- A CORRECÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--   • 'pergunta'                      -> comportamento inalterado.
--   • 'alerta_admin' | 'whatsapp_enviado':
--       - 'estou_bem'      -> FECHA a escada (é a correcção).
--       - 'nao_estou_bem'  -> registra a resposta, mas NÃO desce o degrau:
--                             a escalada já está em curso e uma segunda
--                             negativa não a deve reiniciar.
--   • estados terminais ('estou_bem', 'fechado') -> continua a recusar.
--
-- `answered_at` só é escrito se ainda estiver vazio (COALESCE) — a hora da
-- primeira resposta é a que interessa para auditoria.
--
-- BÓNUS: quando a escada fecha por resposta tardia e o admin já tinha sido
-- avisado, o alerta correspondente em `panic_alerts` é marcado como resolvido.
-- Sem isto ficava um alarme aberto no painel do admin a apontar para um
-- passageiro que já confirmou estar bem. Usa as colunas `status`, `resolved_at`
-- e `resolved_by` acrescentadas na migração 20260916180000.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.answer_ride_safety_check(
  p_check_id UUID,
  p_resposta TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_linha public.ride_safety_checks;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_sessao');
  END IF;

  IF p_resposta NOT IN ('estou_bem', 'nao_estou_bem') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_invalida');
  END IF;

  SELECT * INTO v_linha
  FROM public.ride_safety_checks
  WHERE id = p_check_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Só o passageiro responde. O motorista e o admin não respondem por ele —
  -- responder "estou bem" por outra pessoa é exactamente o que isto evita.
  IF v_linha.passenger_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_o_passageiro');
  END IF;

  -- ── Caso normal: a pergunta ainda está dentro do prazo ────────────────────
  IF v_linha.estado = 'pergunta' THEN
    UPDATE public.ride_safety_checks
    SET
      answer      = p_resposta,
      answered_at = now(),
      estado      = CASE WHEN p_resposta = 'estou_bem' THEN 'estou_bem' ELSE 'alerta_admin' END
    WHERE id = p_check_id;

    RETURN jsonb_build_object(
      'ok',     true,
      'estado', CASE WHEN p_resposta = 'estou_bem' THEN 'estou_bem' ELSE 'alerta_admin' END,
      'tardio', false
    );
  END IF;

  -- ── Resposta tardia: a escada já escalou, mas ainda está aberta ───────────
  IF v_linha.estado IN ('alerta_admin', 'whatsapp_enviado') THEN

    IF p_resposta = 'estou_bem' THEN
      -- A CORRECÇÃO. Trava a escada onde ela estiver.
      UPDATE public.ride_safety_checks
      SET
        answer      = 'estou_bem',
        answered_at = COALESCE(answered_at, now()),
        estado      = 'estou_bem'
      WHERE id = p_check_id;

      -- Se o admin já tinha sido avisado, fechar esse alerta também. Caso
      -- contrário ficava um alarme aberto no painel sobre alguém que acabou
      -- de confirmar que está bem.
      IF v_linha.admin_alert_id IS NOT NULL THEN
        UPDATE public.panic_alerts
        SET
          status      = 'resolved',
          resolved_at = now(),
          resolved_by = v_uid
        WHERE id = v_linha.admin_alert_id
          AND status = 'active';
      END IF;

      RETURN jsonb_build_object('ok', true, 'estado', 'estou_bem', 'tardio', true);
    END IF;

    -- 'nao_estou_bem' numa escada já em curso: registar a resposta, sem mexer
    -- no degrau. A escalada segue; isto só acrescenta a confirmação explícita
    -- de que há mesmo um problema, o que é útil para o admin.
    UPDATE public.ride_safety_checks
    SET
      answer      = 'nao_estou_bem',
      answered_at = COALESCE(answered_at, now())
    WHERE id = p_check_id;

    RETURN jsonb_build_object('ok', true, 'estado', v_linha.estado, 'tardio', true);
  END IF;

  -- ── Estado terminal ('estou_bem', 'fechado') ─────────────────────────────
  RETURN jsonb_build_object('ok', false, 'erro', 'ja_resolvido', 'estado', v_linha.estado);
END;
$$;

-- Os GRANT da migração anterior continuam válidos (CREATE OR REPLACE mantém-nos),
-- mas reafirmamos para que este ficheiro seja auto-suficiente se algum dia for
-- aplicado numa base limpa.
REVOKE ALL ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_ride_safety_check(UUID, TEXT) TO service_role;
