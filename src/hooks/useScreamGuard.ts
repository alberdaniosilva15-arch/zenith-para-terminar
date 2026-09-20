// =============================================================================
// useScreamGuard.ts — o grito armado desde que o app abre
// =============================================================================
// Antes o detector vivia dentro do `PanicButton`, que só existe quando um
// motorista ACEITA a corrida. Ou seja: enquanto se procura carro — ou a andar
// a pé — não havia detecção nenhuma. Aqui passa a estar armado sempre.
//
// Desarma quando o app vai para segundo plano, e isso não é preguiça:
//   • o browser suspende o áudio de qualquer forma;
//   • um microfone aberto sem ninguém a ver gasta bateria à toa;
//   • e é em segundo plano que os falsos positivos se acumulam sem ninguém
//     para os cancelar.
// =============================================================================
import { useEffect, useRef } from 'react';
import { startScreamDetection, type ScreamDetectorHandle } from '../lib/screamDetector';

export interface OpcoesDoGuardiao {
  /** Sessão iniciada. Sem isto não há para onde mandar o alerta. */
  activo: boolean;
  /** ACCEPTED | PICKING_UP | IN_PROGRESS — só aqui entra o wake-word por voz. */
  emCorrida: boolean;
  aoDetectar: (motivo: string) => void;
}

export function useScreamGuard({ activo, emCorrida, aoDetectar }: OpcoesDoGuardiao): void {
  // O callback vive numa ref para o efeito NÃO reiniciar a cada render:
  // reiniciar significa voltar a pedir o microfone, e o browser só concede
  // `getUserMedia` uma vez por gesto.
  const callbackRef = useRef(aoDetectar);
  callbackRef.current = aoDetectar;

  useEffect(() => {
    if (!activo) return;

    let handle: ScreamDetectorHandle | null = null;

    const armar = () => {
      if (handle) return;
      handle = startScreamDetection(
        (motivo) => callbackRef.current(motivo),
        // ⚠️ `voz` só em corrida: é o caminho que envia áudio para a Google.
        { voz: emCorrida },
      );
    };

    const desarmar = () => {
      handle?.stop();
      handle = null;
    };

    const aoMudarVisibilidade = () => (document.hidden ? desarmar() : armar());
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    if (!document.hidden) armar();

    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      desarmar();
    };
  }, [activo, emCorrida]);
}
