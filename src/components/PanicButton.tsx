import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  construirMensagemDeEmergencia,
  linkDoWhatsApp,
  linkDoSms,
  abrirAbaParaOWhatsApp,
  levarAbaPara,
  enviarSmsNativo,
  makeEmergencyCall,
} from '../lib/nativeEmergency';
import { dispararPanico, type PanicSource } from '../lib/panicDispatcher';

interface PanicButtonProps {
  userId: string;
  rideId?: string;
  emergencyPhone?: string;
  driverName?: string;
  counterpartyName?: string;
  counterpartyLabel?: string;
  silentSignal?: number;
  /** Matrícula e marca/cor da viatura, para a mensagem ao contacto. */
  matricula?: string;
  marcaECor?: string;
  origem?: string;
  destino?: string;
  telefonePassageiro?: string;
}

/** Segundos que o contacto leva a ser chamado, com hipótese de travar. */
const SEGUNDOS_ATE_LIGAR = 3;

export default function PanicButton({
  userId,
  rideId,
  emergencyPhone,
  driverName,
  counterpartyName,
  counterpartyLabel = 'Motorista',
  silentSignal,
  matricula,
  marcaECor,
  origem,
  destino,
  telefonePassageiro,
}: PanicButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [sent, setSent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);
  const [silentAcknowledged, setSilentAcknowledged] = useState(false);
  const [emergencyContactMissing, setEmergencyContactMissing] = useState(false);
  const [falhaAoRegistar, setFalhaAoRegistar] = useState<string | null>(null);

  // Links prontos a tocar. O `<a href>` é a única forma que nenhum browser
  // bloqueia — por isso é ele que fica no ecrã, mesmo quando a aba automática
  // já abriu. Uma rede de segurança que não custa nada.
  const [linkWhatsApp, setLinkWhatsApp] = useState<string | null>(null);
  const [linkSms, setLinkSms] = useState<string | null>(null);
  const [segundosParaLigar, setSegundosParaLigar] = useState<number | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSilentSignalRef = useRef<number | undefined>(silentSignal);
  const silentFeedbackResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ligarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedCounterparty = counterpartyName ?? driverName;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
      if (silentFeedbackResetRef.current) clearTimeout(silentFeedbackResetRef.current);
      if (ligarTimerRef.current) clearTimeout(ligarTimerRef.current);
      if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
    };
  }, []);

  const triggerPanicRef = useRef<
    (silent?: boolean, source?: PanicSource, janela?: Window | null) => Promise<void>
  >(async () => {});

  // A escada de segurança (corrida a passar 1,5× o previsto) continua a entrar
  // por aqui. O GRITO saiu daqui — vive no `ScreamGuard`, porque tem de estar
  // armado mesmo sem corrida nenhuma.
  useEffect(() => {
    if (silentSignal == null || silentSignal === lastSilentSignalRef.current) {
      return;
    }
    lastSilentSignalRef.current = silentSignal;
    void triggerPanicRef.current(true, 'escada_corrida');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silentSignal, rideId, emergencyPhone, resolvedCounterparty]);

  // Contagem até a chamada sair, com hipótese de travar.
  useEffect(() => {
    if (segundosParaLigar == null) return;
    if (segundosParaLigar <= 0) {
      if (emergencyPhone) makeEmergencyCall(emergencyPhone);
      setSegundosParaLigar(null);
      return;
    }
    const t = setTimeout(() => setSegundosParaLigar((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [segundosParaLigar, emergencyPhone]);

  /**
   * Grava e liga o ficheiro ao alerta.
   *
   * ⚠️ `idDoAlerta` é uma promessa e não um id porque a gravação arranca assim
   * que o alerta existe — e o caminho do ficheiro só é preciso no fim, quando
   * o `onstop` corre. Era aqui que o F1 se perdia: o ficheiro ia para
   * `pending/` e nunca mais era encontrado.
   */
  const startAudioRecording = async (silent: boolean, idDoAlerta?: Promise<string | null>) => {
    if (!silent) setAudioSaved(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = async (event) => {
        if (event.data.size <= 0) return;
        chunksRef.current.push(event.data);

        // Difusão em tempo real para o painel de admin.
        try {
          const reader = new FileReader();
          reader.readAsDataURL(event.data);
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            await supabase.channel(`emergency_audio_${userId}`).send({
              type: 'broadcast',
              event: 'audio_chunk',
              payload: { user_id: userId, ride_id: rideId, timestamp: Date.now(), audio_data: base64Audio },
            });
          };
        } catch (e) {
          console.warn('[PanicButton] Falha no broadcast de audio:', e);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        try {
          const alertId = (await idDoAlerta?.catch(() => null)) ?? null;

          if (!alertId) {
            // Nunca gravar para `pending/`: um ficheiro órfão não serve para
            // nada e nunca mais é encontrado. Melhor não guardar e deixar rasto.
            console.warn('[PanicButton] Audio sem alerta associado — nao guardado.');
            if (!silent) setAudioSaved(false);
            return;
          }

          const filename = `${userId}/${alertId}/panic_${Date.now()}.webm`;
          const { error: uploadError } = await supabase.storage
            .from('panic-audio')
            .upload(filename, blob, { contentType: 'audio/webm' });

          if (uploadError) throw uploadError;

          // ⚠️ Verificar o erro do UPDATE. Sem isto, o ficheiro ficava no
          // bucket e o alerta sem ponteiro — em silêncio.
          const { error: erroLigacao } = await supabase
            .from('panic_alerts')
            .update({ audio_storage_path: filename, audio_bytes: blob.size })
            .eq('id', alertId);

          if (erroLigacao) {
            console.error('[PanicButton] Audio gravado mas NAO ligado ao alerta:', erroLigacao);
            if (!silent) setAudioSaved(false);
            return;
          }

          if (!silent) setAudioSaved(true);
        } catch (err) {
          console.warn('[PanicButton] Erro ao guardar audio de emergencia:', err);
          if (!silent) setAudioSaved(false);
        } finally {
          if (!silent) setRecording(false);
        }
      };

      mediaRef.current = recorder;
      recorder.start(2000);

      if (!silent) setRecording(true);

      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 30000);
    } catch (err) {
      console.warn('[PanicButton] Sem acesso ao microfone:', err);
    }
  };

  /**
   * Leva o alerta ao contacto. O `janela` vem do gesto do utilizador (quando
   * houve um) e é a aba já pré-aberta — é isso que faz o WhatsApp abrir
   * sozinho sem ser bloqueado.
   */
  const avisarOContacto = async (
    pos: { latitude?: number; longitude?: number },
    janela: Window | null,
  ): Promise<void> => {
    if (!emergencyPhone) {
      setEmergencyContactMissing(true);
      return;
    }

    const mensagem = construirMensagemDeEmergencia({
      nomeMotorista: resolvedCounterparty,
      matricula,
      marcaECor,
      origem,
      destino,
      lat: pos.latitude ?? null,
      lng: pos.longitude ?? null,
      telefonePassageiro,
    });

    const wa = linkDoWhatsApp(emergencyPhone, mensagem);
    setLinkWhatsApp(wa);
    setLinkSms(linkDoSms(emergencyPhone, mensagem));

    // 1. WhatsApp — pela aba pré-aberta, quando houve gesto.
    const abriu = levarAbaPara(janela, wa);
    if (!abriu) {
      console.warn('[PanicButton] Sem aba pré-aberta — o botão no ecrã é o caminho.');
    }

    // 2. SMS nativo — só existe numa app empacotada. No browser devolve false
    //    e o botão `sms:` no ecrã é o caminho.
    void enviarSmsNativo({ telefone: emergencyPhone, mensagem });

    // 3. Chamada — a qualquer hora, com hipótese de travar.
    setSegundosParaLigar(SEGUNDOS_ATE_LIGAR);

    setEmergencyContactMissing(false);
  };

  const triggerPanic = async (
    silent = false,
    source: PanicSource = 'botao_panico',
    janela: Window | null = null,
  ) => {
    if (!silent && !pressed) {
      setPressed(true);
      if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
      confirmResetRef.current = setTimeout(() => setPressed(false), 5000);
      return;
    }

    if (!silent) {
      setSent(true);
      setPressed(false);
    } else {
      setSilentAcknowledged(true);
      navigator.vibrate?.([80, 60, 80]);
      if (silentFeedbackResetRef.current) clearTimeout(silentFeedbackResetRef.current);
      silentFeedbackResetRef.current = setTimeout(() => setSilentAcknowledged(false), 1800);
    }

    setFalhaAoRegistar(null);

    // 1. O ALERTA NASCE JÁ — sem esperar por GPS nenhum.
    const { alertaId, posicao, erro } = await dispararPanico({
      userId,
      rideId,
      emergencyPhone,
      driverName: resolvedCounterparty,
      source,
      severity: silent ? 'critical' : 'high',
    });

    if (erro || !alertaId) {
      // Já não se engole: o alerta NÃO existe e quem está a pedir socorro tem
      // de saber, para poder ligar 113/112 à mão.
      setFalhaAoRegistar(erro ?? 'sem id de volta');
      return;
    }

    // 2. A gravação liga-se ao id que acabou de nascer.
    void startAudioRecording(silent, Promise.resolve(alertaId));

    // 3. As coordenadas entram quando chegarem (tecto 3 s) e só depois é que
    //    o contacto é avisado — para a mensagem já levar a localização.
    const pos = await posicao;
    await avisarOContacto(pos, janela);
  };

  useEffect(() => {
    triggerPanicRef.current = triggerPanic;
  });

  /** O clique do botão. A aba abre AQUI, ainda dentro do gesto. */
  const aoCarregarNoBotao = () => {
    if (!pressed) {
      void triggerPanic(false, 'botao_panico');
      return;
    }

    // Segundo toque = a sério. ⚠️ A aba tem de nascer antes de qualquer
    // `await`, senão o browser bloqueia-a em silêncio. É esta linha que faz o
    // WhatsApp abrir sozinho.
    const janela = abrirAbaParaOWhatsApp();
    void triggerPanic(false, 'botao_panico', janela);
  };

  if (sent) {
    return (
      <div className="zr-card" style={{ border: '1px solid var(--danger-soft)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="zr-inline" style={{ gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', background: 'rgba(239, 68, 68, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>emergency</span>
          </div>
          <div>
            <strong style={{ color: 'var(--danger-soft)', display: 'block', marginBottom: '4px' }}>
              {falhaAoRegistar ? 'Alerta NÃO registado' : 'Alerta enviado'}
            </strong>
            <span className="zr-meta" style={{ color: 'var(--danger-soft)', opacity: 0.8 }}>
              {falhaAoRegistar
                ? 'Não conseguimos registar o alerta. Liga 113 ou 112 agora.'
                : emergencyContactMissing
                  ? 'Central SOS registada. Define um contacto de emergência para avisar alguém.'
                  : 'Contacto de emergência avisado'}
            </span>
          </div>
        </div>

        {recording && (
          <div className="zr-chip zr-chip--danger" style={{ justifyContent: 'flex-start' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--danger)', borderRadius: '50%', marginRight: '8px' }} className="animate-pulse" />
            A gravar audio de emergência... (30s)
          </div>
        )}

        {audioSaved && !recording && (
          <div className="zr-chip zr-chip--success" style={{ justifyContent: 'flex-start' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle', marginRight: '8px' }}>check_circle</span>
            Áudio de evidência guardado e ligado ao alerta
          </div>
        )}

        {segundosParaLigar != null && (
          <div className="zr-chip zr-chip--danger" style={{ justifyContent: 'space-between' }}>
            <span>A ligar ao contacto em {segundosParaLigar}s</span>
            <button
              type="button"
              onClick={() => setSegundosParaLigar(null)}
              className="zr-button zr-button--secondary"
              style={{ padding: '4px 10px', fontSize: '10px' }}
            >
              Travar
            </button>
          </div>
        )}

        {/* A rede de segurança: um <a href> verdadeiro nunca é bloqueado. */}
        {linkWhatsApp && (
          <a
            href={linkWhatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="zr-button zr-button--danger zr-button--block"
            style={{ justifyContent: 'center', fontWeight: 700 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle', marginRight: '6px' }}>chat</span>
            Abrir WhatsApp para o contacto
          </a>
        )}

        {linkSms && (
          <a
            href={linkSms}
            className="zr-button zr-button--secondary zr-button--block"
            style={{ justifyContent: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle', marginRight: '6px' }}>sms</span>
            Enviar SMS ao contacto
          </a>
        )}

        <div className="zr-inline" style={{ gap: '8px' }}>
          <a href="tel:113" className="zr-button zr-button--danger zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>call</span> Ligar 113
          </a>
          <a href="tel:112" className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px', color: 'var(--danger-soft)', borderColor: 'var(--danger-soft)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>call</span> Ligar 112
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {silentAcknowledged && (
        <div className="zr-chip zr-chip--danger" style={{ justifyContent: 'flex-start' }}>
          SOS silencioso activado. O alerta foi disparado discretamente.
        </div>
      )}

      {!emergencyPhone && (
        <div className="zr-alert-box zr-alert-box--warning" style={{ marginBottom: 0 }}>
          <div className="zr-alert-content">
            <strong>Contacto de emergência em falta</strong>
            <p>O SOS continua a guardar e difundir o alerta, mas sem avisar ninguém.</p>
          </div>
        </div>
      )}

      <button
        onClick={aoCarregarNoBotao}
        className={`zr-button zr-button--block ${pressed ? 'zr-button--danger animate-pulse' : 'zr-button--secondary'}`}
        style={pressed ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)' } : { color: 'var(--danger-soft)', borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
      >
        {pressed
          ? <><span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>emergency</span> CONFIRMA - toca de novo para enviar alerta</>
          : <><span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>shield</span> Botão de Pânico (SOS)</>}
      </button>
    </div>
  );
}
