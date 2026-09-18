// =============================================================================
// ZENITH RIDE — SafetyCheckPrompt.tsx
// O aviso "Está tudo bem?" que aparece ao passageiro durante a corrida.
//
// COMO SE ENCAIXA NA ESCADA
// ─────────────────────────────────────────────────────────────────────────────
// Quem manda é o Edge Function `sos-escalation`, que corre a cada minuto:
//
//   corrida longa (duração prevista × 1,5)
//        └─> abre a pergunta            estado = 'pergunta'      2 min
//              ├─ "estou bem"      ──> fecha
//              ├─ "não estou bem"  ──> alerta o admin            2 min
//              └─ silêncio         ──> alerta o admin           10 min
//                                          └─> WhatsApp ao contacto de segurança
//
// Este componente NÃO decide nada. Só mostra o que o motor decidiu e devolve a
// resposta. Toda a regra está em `logica.ts`; aqui não há prazos nem limiares.
//
// ⚠️ A CONTAGEM DECRESCENTE VEM DO PRAZO DO SERVIDOR, não de um "2 minutos"
// escrito aqui. Se fosse local, um telefone com o relógio adiantado diria ao
// passageiro que ainda tinha tempo quando o motor já tinha escalado — ou o
// contrário. O número que se vê é `answer_deadline` menos a hora local, e a
// decisão de escalar é do servidor de qualquer forma.
//
// ⚠️ RESPOSTA TARDIA É ACEITE. Se o passageiro perder o aviso e só responder
// depois de o admin já ter sido avisado, a escada ainda trava (ver migração
// 20260916190000). Alarme falso repetido ensina o contacto a ignorar o próximo.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface SafetyCheckPromptProps {
  rideId: string;
}

type EstadoEscada =
  | 'pergunta'
  | 'estou_bem'
  | 'alerta_admin'
  | 'whatsapp_enviado'
  | 'fechado';

interface EscadaDoServidor {
  id: string;
  ride_id: string;
  estado: EstadoEscada;
  asked_at: string;
  answer_deadline: string;
  answered_at: string | null;
  answer: 'estou_bem' | 'nao_estou_bem' | null;
}

/** Formata milissegundos como m:ss, nunca abaixo de zero. */
function formatarRestante(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

export const SafetyCheckPrompt: React.FC<SafetyCheckPromptProps> = ({ rideId }) => {
  const [escada, setEscada] = useState<EscadaDoServidor | null>(null);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  const [aEnviar, setAEnviar] = useState<'estou_bem' | 'nao_estou_bem' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Evita escrever estado depois de o componente sair (corrida terminada).
  const montadoRef = useRef(true);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_ride_safety_check', {
      p_ride_id: rideId,
    });
    if (!montadoRef.current) return;
    if (error) {
      // Falhar a ler a escada não pode rebentar a corrida. Fica silencioso no
      // ecrã; o motor continua a vigiar do lado do servidor de qualquer forma.
      console.warn('[SafetyCheckPrompt] não consegui ler a escada:', error.message);
      return;
    }
    setEscada((data as EscadaDoServidor | null) ?? null);
  }, [rideId]);

  // ── Carregar + ficar à escuta ──────────────────────────────────────────────
  useEffect(() => {
    montadoRef.current = true;
    void carregar();

    const canal = supabase
      .channel(`safety-check-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ride_safety_checks',
          filter: `ride_id=eq.${rideId}`,
        },
        () => {
          // Não tentamos interpretar o payload: relemos pela RPC, que é quem
          // aplica as regras de quem pode ver o quê.
          void carregar();
        },
      )
      .subscribe();

    return () => {
      montadoRef.current = false;
      supabase.removeChannel(canal);
    };
  }, [rideId, carregar]);

  // ── Relógio: só corre enquanto há uma contagem para mostrar ───────────────
  const emContagem = escada?.estado === 'pergunta' && !escada.answered_at;

  useEffect(() => {
    if (!emContagem) return;
    setAgoraMs(Date.now());
    const id = window.setInterval(() => setAgoraMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [emContagem]);

  const responder = async (resposta: 'estou_bem' | 'nao_estou_bem') => {
    if (!escada || aEnviar) return;
    setAEnviar(resposta);
    setErro(null);

    const { data, error } = await supabase.rpc('answer_ride_safety_check', {
      p_check_id: escada.id,
      p_resposta: resposta,
    });

    if (!montadoRef.current) return;
    setAEnviar(null);

    if (error) {
      setErro('Não consegui registar a tua resposta. Tenta outra vez.');
      return;
    }

    // A RPC devolve { ok, estado, tardio } ou { ok:false, erro }.
    const resultado = data as
      | { ok?: boolean; estado?: EstadoEscada; erro?: string }
      | null;

    if (resultado?.ok === false) {
      // 'ja_resolvido' é benigno — a escada já fechou por outro caminho.
      if (resultado.erro !== 'ja_resolvido') {
        setErro('Não consegui registar a tua resposta. Tenta outra vez.');
      }
      void carregar();
      return;
    }

    await carregar();
  };

  // Nada para mostrar (sem escada aberta, ou já fechada sem mais nada a dizer).
  if (!escada) return null;
  if (escada.estado === 'fechado') return null;

  // ── Fechada porque o passageiro confirmou que está bem ────────────────────
  if (escada.estado === 'estou_bem') {
    return (
      <div
        className="zr-alert-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'rgba(34,197,94,0.08)',
          borderColor: 'rgba(34,197,94,0.25)',
        }}
      >
        <span className="material-symbols-outlined" style={{ color: '#22c55e' }}>
          verified_user
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="zr-kicker" style={{ color: '#22c55e' }}>
            Confirmado · tudo bem
          </p>
          <p className="zr-copy" style={{ opacity: 0.75 }}>
            Obrigado por confirmar. Boa viagem.
          </p>
        </div>
      </div>
    );
  }

  // ── Escalada em curso: o passageiro não respondeu a tempo ─────────────────
  // Continua a aceitar resposta — é precisamente aqui que a resposta tardia
  // trava um alarme falso (ver migração 20260916190000).
  if (escada.estado === 'alerta_admin' || escada.estado === 'whatsapp_enviado') {
    const jaNoWhatsApp = escada.estado === 'whatsapp_enviado';
    return (
      <div
        role="alert"
        className="zr-alert-box"
        style={{
          background: 'rgba(245,158,11,0.10)',
          borderColor: 'rgba(245,158,11,0.35)',
          display: 'block',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <span className="material-symbols-outlined" style={{ color: '#f59e0b' }}>
            notification_important
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="zr-kicker" style={{ color: '#f59e0b' }}>
              Não respondeste a tempo
            </p>
            <p className="zr-copy" style={{ opacity: 0.85 }}>
              {jaNoWhatsApp
                ? 'Já avisámos o teu contacto de segurança. Se estás bem, diz-nos agora para travar.'
                : 'A equipa de segurança foi avisada. Se estás bem, diz-nos agora para travar.'}
            </p>
          </div>
        </div>

        {erro && (
          <p className="zr-copy" style={{ color: 'var(--danger-soft)', marginBottom: '8px' }}>
            {erro}
          </p>
        )}

        <button
          type="button"
          onClick={() => void responder('estou_bem')}
          disabled={aEnviar !== null}
          className="zr-button zr-button--block zr-button--success"
          style={{ padding: '14px 0', fontWeight: 800 }}
        >
          {aEnviar === 'estou_bem' ? (
            'A confirmar...'
          ) : (
            <>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '18px', marginRight: '8px' }}
              >
                check_circle
              </span>
              Estou bem — travar o aviso
            </>
          )}
        </button>
      </div>
    );
  }

  // ── A pergunta, dentro do prazo ───────────────────────────────────────────
  const restanteMs = Date.parse(escada.answer_deadline) - agoraMs;
  const semTempo = restanteMs <= 0;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="zr-alert-box"
      style={{
        background: 'rgba(212,175,55,0.10)',
        borderColor: 'rgba(212,175,55,0.40)',
        display: 'block',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--gold)' }}>
          health_and_safety
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="zr-kicker" style={{ color: 'var(--gold)' }}>
            Está tudo bem?
          </p>
          <p className="zr-copy" style={{ opacity: 0.85 }}>
            {semTempo
              ? 'A verificar contigo... responde por favor.'
              : `Esta corrida já vai longa. Responde em ${formatarRestante(restanteMs)}.`}
          </p>
        </div>
        {/* A contagem é do servidor; o anel só a torna visível num relance. */}
        <div
          aria-hidden="true"
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 800,
            fontSize: '15px',
            color: 'var(--gold)',
            opacity: semTempo ? 0.4 : 1,
            minWidth: '42px',
            textAlign: 'right',
          }}
        >
          {semTempo ? '—' : formatarRestante(restanteMs)}
        </div>
      </div>

      {erro && (
        <p className="zr-copy" style={{ color: 'var(--danger-soft)', marginBottom: '8px' }}>
          {erro}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <button
          type="button"
          onClick={() => void responder('estou_bem')}
          disabled={aEnviar !== null}
          className="zr-button zr-button--block zr-button--success"
          style={{ padding: '16px 0', fontWeight: 800 }}
        >
          {aEnviar === 'estou_bem' ? (
            'A confirmar...'
          ) : (
            <>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '18px', marginRight: '6px' }}
              >
                check_circle
              </span>
              Estou bem
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => void responder('nao_estou_bem')}
          disabled={aEnviar !== null}
          className="zr-button zr-button--block zr-button--danger"
          style={{ padding: '16px 0', fontWeight: 800 }}
        >
          {aEnviar === 'nao_estou_bem' ? (
            'A pedir ajuda...'
          ) : (
            <>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '18px', marginRight: '6px' }}
              >
                emergency
              </span>
              Não estou bem
            </>
          )}
        </button>
      </div>

      <p className="zr-copy" style={{ opacity: 0.55, marginTop: '10px', fontSize: '10px' }}>
        Se não responderes, a equipa de segurança é avisada automaticamente.
      </p>
    </div>
  );
};

export default SafetyCheckPrompt;
