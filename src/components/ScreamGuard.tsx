// =============================================================================
// ScreamGuard.tsx — o grito, do detector ao contacto
// =============================================================================
// Três momentos, e a ordem entre eles é o que decide se isto serve para alguma
// coisa:
//
//   1. DETECTA  — o microfone apanha um grito (amplitude) ou a palavra-chave.
//   2. PERGUNTA — 15 segundos de contagem com um botão grande para travar.
//                 ⚠️ NÃO CANCELAR = ENVIAR. A janela é de CANCELAMENTO, não de
//                 confirmação: quem tem o telemóvel no bolso não confirma nada
//                 e o socorro tem de sair à mesma.
//   3. AVISA    — alerta criado, contacto avisado, links à mão.
//
// Porque é que isto não abre o WhatsApp sozinho: sem um toque, o browser não
// deixa abrir nada — e a única alternativa (`window.location.href`) aborta a
// gravação e mata a sessão. Por isso aqui ficam BOTÕES GRANDES, e o caminho
// que não depende de ninguém olhar para o ecrã é o do servidor.
// =============================================================================
import { useEffect, useState } from 'react';
import { useScreamGuard } from '../hooks/useScreamGuard';
import { dispararPanico } from '../lib/panicDispatcher';
import {
  construirMensagemDeEmergencia,
  linkDoWhatsApp,
  linkDoSms,
  enviarSmsNativo,
  makeEmergencyCall,
} from '../lib/nativeEmergency';

/** Segundos para travar um falso positivo antes de o alerta sair. */
const SEGUNDOS_DE_CANCELAMENTO = 15;

export interface ScreamGuardProps {
  userId?: string;
  rideId?: string;
  emCorrida: boolean;
  emergencyPhone?: string;
  driverName?: string;
  matricula?: string;
  marcaECor?: string;
  origem?: string;
  destino?: string;
  telefonePassageiro?: string;
}

interface Pendente {
  motivo: string;
  restam: number;
}

interface Enviado {
  links: { whatsapp: string | null; sms: string | null };
  semContacto: boolean;
  falhou: boolean;
}

export default function ScreamGuard({
  userId,
  rideId,
  emCorrida,
  emergencyPhone,
  driverName,
  matricula,
  marcaECor,
  origem,
  destino,
  telefonePassageiro,
}: ScreamGuardProps) {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [enviado, setEnviado] = useState<Enviado | null>(null);

  useScreamGuard({
    activo: Boolean(userId),
    emCorrida,
    aoDetectar: (motivo) => setPendente({ motivo, restam: SEGUNDOS_DE_CANCELAMENTO }),
  });

  // 1. A contagem. Só corre enquanto há tempo.
  useEffect(() => {
    if (!pendente || pendente.restam <= 0) return;
    const t = setTimeout(
      () => setPendente((p) => (p ? { ...p, restam: p.restam - 1 } : null)),
      1000,
    );
    return () => clearTimeout(t);
  }, [pendente]);

  // 2. Chegou a zero — o alerta sai. (Quem trava é o botão, que põe a null.)
  useEffect(() => {
    if (!pendente || pendente.restam > 0 || !userId) return;

    const motivo = pendente.motivo;
    setPendente(null);

    void (async () => {
      console.warn('[ScreamGuard] A enviar o SOS do grito:', motivo);

      const { alertaId, posicao, erro } = await dispararPanico({
        userId,
        rideId,
        emergencyPhone,
        driverName,
        source: 'grito',
        severity: 'critical',
      });

      if (erro || !alertaId) {
        setEnviado({ links: { whatsapp: null, sms: null }, semContacto: !emergencyPhone, falhou: true });
        return;
      }

      const pos = await posicao;

      if (!emergencyPhone) {
        setEnviado({ links: { whatsapp: null, sms: null }, semContacto: true, falhou: false });
        return;
      }

      const mensagem = construirMensagemDeEmergencia({
        nomeMotorista: driverName,
        matricula,
        marcaECor,
        origem,
        destino,
        lat: pos.latitude ?? null,
        lng: pos.longitude ?? null,
        telefonePassageiro,
      });

      setEnviado({
        links: {
          whatsapp: linkDoWhatsApp(emergencyPhone, mensagem),
          sms: linkDoSms(emergencyPhone, mensagem),
        },
        semContacto: false,
        falhou: false,
      });

      // O SMS nativo só existe empacotado; no browser devolve false e o botão
      // `sms:` no ecrã é o caminho. A chamada sai a seguir.
      void enviarSmsNativo({ telefone: emergencyPhone, mensagem });
      setTimeout(() => makeEmergencyCall(emergencyPhone), 2500);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendente, userId, rideId, emergencyPhone, driverName, matricula, marcaECor, origem, destino, telefonePassageiro]);

  // ── Aviso do falso positivo: grande, no meio, impossível de não ver ───────
  if (pendente) {
    return (
      <div
        role="alert"
        style={{
          position: 'fixed', inset: 0, zIndex: 3000,
          background: 'rgba(0,0,0,0.88)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '18px', padding: '24px', textAlign: 'center',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '64px', color: 'var(--danger-soft)' }}>
          emergency
        </span>
        <strong style={{ fontSize: '20px', color: '#fff' }}>
          Ouvimos um pedido de ajuda
        </strong>
        <p style={{ color: 'rgba(255,255,255,0.85)', margin: 0, maxWidth: '320px' }}>
          A avisar o teu contacto de emergência em
          <strong style={{ color: 'var(--danger-soft)' }}> {pendente.restam}s</strong>.
        </p>
        <button
          type="button"
          onClick={() => setPendente(null)}
          className="zr-button zr-button--block"
          style={{ maxWidth: '320px', justifyContent: 'center', fontWeight: 700 }}
        >
          Não é nada — cancelar
        </button>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>
          Se não tocares, o alerta segue. É assim de propósito.
        </span>
      </div>
    );
  }

  // ── Já saiu: os links ficam à mão ─────────────────────────────────────────
  if (enviado) {
    return (
      <div
        role="alert"
        style={{
          position: 'fixed', left: '12px', right: '12px', bottom: '12px', zIndex: 3000,
          background: 'rgba(20,20,20,0.96)',
          border: '1px solid var(--danger-soft)',
          borderRadius: '14px', padding: '16px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}
      >
        <strong style={{ color: 'var(--danger-soft)' }}>
          {enviado.falhou
            ? 'Não conseguimos registar o alerta'
            : enviado.semContacto
              ? 'Alerta registado — sem contacto definido'
              : 'Contacto de emergência avisado'}
        </strong>

        {enviado.links.whatsapp && (
          <a
            href={enviado.links.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="zr-button zr-button--danger zr-button--block"
            style={{ justifyContent: 'center', fontWeight: 700 }}
          >
            Abrir WhatsApp para o contacto
          </a>
        )}

        {enviado.links.sms && (
          <a href={enviado.links.sms} className="zr-button zr-button--secondary zr-button--block" style={{ justifyContent: 'center' }}>
            Enviar SMS ao contacto
          </a>
        )}

        <div className="zr-inline" style={{ gap: '8px' }}>
          <a href="tel:113" className="zr-button zr-button--danger zr-button--block" style={{ flex: 1, justifyContent: 'center' }}>Ligar 113</a>
          <a href="tel:112" className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1, justifyContent: 'center' }}>Ligar 112</a>
        </div>

        <button
          type="button"
          onClick={() => setEnviado(null)}
          className="zr-button zr-button--secondary zr-button--block"
          style={{ justifyContent: 'center' }}
        >
          Fechar
        </button>
      </div>
    );
  }

  return null;
}
