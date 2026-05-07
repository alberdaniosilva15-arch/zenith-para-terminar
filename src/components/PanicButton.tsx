import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sendNativeEmergencySMS, makeEmergencyCall, buildEmergencyMessage, isNightTime } from '../lib/nativeEmergency';
import { startScreamDetection } from '../lib/screamDetector';

interface PanicButtonProps {
  userId: string;
  rideId?: string;
  emergencyPhone?: string;
  driverName?: string;
  counterpartyName?: string;
  counterpartyLabel?: string;
  silentSignal?: number;
  enableScreamDetection?: boolean;
}

export default function PanicButton({
  userId,
  rideId,
  emergencyPhone,
  driverName,
  counterpartyName,
  counterpartyLabel = 'Motorista',
  silentSignal,
  enableScreamDetection = false,
}: PanicButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [sent, setSent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);
  const [silentAcknowledged, setSilentAcknowledged] = useState(false);
  const [emergencyContactMissing, setEmergencyContactMissing] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSilentSignalRef = useRef<number | undefined>(silentSignal);
  const activeAlertIdRef = useRef<string | null>(null);
  const silentFeedbackResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedCounterparty = counterpartyName ?? driverName;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (confirmResetRef.current) {
        clearTimeout(confirmResetRef.current);
      }
      if (silentFeedbackResetRef.current) {
        clearTimeout(silentFeedbackResetRef.current);
      }
      if (mediaRef.current?.state === 'recording') {
        mediaRef.current.stop();
      }
    };
  }, []);

  // Detecção de gritos — activa durante corrida nocturna
  useEffect(() => {
    if (!enableScreamDetection || !rideId) return;
    const handle = startScreamDetection(() => {
      console.warn('[PanicButton] Grito detectado — activando SOS silencioso');
      void triggerPanic(true);
    });
    return () => { handle?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableScreamDetection, rideId]);

  useEffect(() => {
    if (silentSignal == null || silentSignal === lastSilentSignalRef.current) {
      return;
    }

    lastSilentSignalRef.current = silentSignal;
    void triggerPanic(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silentSignal, rideId, emergencyPhone, resolvedCounterparty]);

  const startAudioRecording = async (silent: boolean) => {
    if (!silent) {
      setAudioSaved(false);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);

          // Emitir audio via Supabase Realtime (Live Stream)
          try {
            const reader = new FileReader();
            reader.readAsDataURL(event.data);
            reader.onloadend = async () => {
              const base64Audio = (reader.result as string).split(',')[1];
              await supabase.channel(`emergency_audio_${userId}`).send({
                type: 'broadcast',
                event: 'audio_chunk',
                payload: {
                  user_id: userId,
                  ride_id: rideId,
                  timestamp: Date.now(),
                  audio_data: base64Audio,
                },
              });
            };
          } catch (e) {
            console.warn('[PanicButton] Falha no broadcast de audio:', e);
          }
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        try {
          const alertId = activeAlertIdRef.current;
          const filename = `${userId}/${alertId ?? 'pending'}/panic_${Date.now()}.webm`;
          const { error: uploadError } = await supabase.storage
            .from('panic-audio')
            .upload(filename, blob, { contentType: 'audio/webm' });

          if (uploadError) {
            throw uploadError;
          }

          if (alertId) {
            await supabase
              .from('panic_alerts')
              .update({ audio_storage_path: filename })
              .eq('id', alertId);
          }

          if (!silent) {
            setAudioSaved(true);
          }
        } catch (err) { 
          console.warn('[PanicButton] Supabase webhook auth fail:', err);
          if (!silent) {
            setAudioSaved(false);
          }
          console.warn('[PanicButton] Erro ao guardar audio de emergencia.');
        } finally {
          if (!silent) {
            setRecording(false);
          }
        }
      };

      mediaRef.current = recorder;
      recorder.start(2000); // Emite um chunk a cada 2 segundos

      if (!silent) {
        setRecording(true);
      }

      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 30000);
    } catch (err) {
      console.warn('[PanicButton] Sem acesso ao microfone:', err);
    }
  };

  const persistPanic = async (
    latitude?: number,
    longitude?: number,
    severity: 'high' | 'critical' = 'high',
  ) => {
    const payload: Record<string, unknown> = {
      user_id: userId,
      ride_id: rideId ?? null,
      driver_name: resolvedCounterparty ?? null,
      severity,
      created_at: new Date().toISOString(),
    };

    if (typeof latitude === 'number' && typeof longitude === 'number') {
      payload.lat = latitude;
      payload.lng = longitude;
    }

    try {
      const { data } = await supabase
        .from('panic_alerts')
        .insert(payload)
        .select('id')
        .single();

      activeAlertIdRef.current = data?.id ?? null;

      try {
        await supabase.channel('panic_alerts_live').send({
          type: 'broadcast',
          event: 'panic_triggered',
          payload: {
            id: data?.id ?? null,
            ...payload,
          },
        });
      } catch (broadcastError) {
        console.warn('[PanicButton] Broadcast SOS falhou:', broadcastError);
      }

      return data?.id ?? null;
    } catch (err) { 
      console.warn('[PanicButton] Fetch fail:', err);
      // Falha silenciosa para nunca bloquear o SOS.
      activeAlertIdRef.current = null;
      return null;
    }
  };

  const sendEmergencyAlerts = (latitude?: number, longitude?: number) => {
    if (!emergencyPhone) {
      setEmergencyContactMissing(true);
      return false;
    }

    const message = buildEmergencyMessage({
      driverName: resolvedCounterparty,
      lat: latitude,
      lng: longitude,
    });

    // 1. SMS nativo (funciona sem internet)
    sendNativeEmergencySMS({ phone: emergencyPhone, message }).catch(err =>
      console.warn('[PanicButton] SMS nativo falhou:', err)
    );

    // 2. Chamada automática (se noite)
    if (isNightTime()) {
      setTimeout(() => makeEmergencyCall(emergencyPhone), 3000);
    }

    setEmergencyContactMissing(false);
    return true;
  };

  const triggerPanic = async (silent = false) => {
    if (!silent && !pressed) {
      setPressed(true);
      if (confirmResetRef.current) {
        clearTimeout(confirmResetRef.current);
      }
      confirmResetRef.current = setTimeout(() => setPressed(false), 5000);
      return;
    }

    if (!silent) {
      setSent(true);
      setPressed(false);
    } else {
      setSilentAcknowledged(true);
      navigator.vibrate?.([80, 60, 80]);
      if (silentFeedbackResetRef.current) {
        clearTimeout(silentFeedbackResetRef.current);
      }
      silentFeedbackResetRef.current = setTimeout(() => setSilentAcknowledged(false), 1800);
    }

    void startAudioRecording(silent);
    activeAlertIdRef.current = null;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await persistPanic(latitude, longitude, silent ? 'critical' : 'high');
        sendEmergencyAlerts(latitude, longitude);
      },
      async () => {
        await persistPanic(undefined, undefined, silent ? 'critical' : 'high');
        sendEmergencyAlerts();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      },
    );
  };

  if (sent) {
    return (
      <div className="zr-card" style={{ border: '1px solid var(--danger-soft)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="zr-inline" style={{ gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', background: 'rgba(239, 68, 68, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            🆘
          </div>
          <div>
            <strong style={{ color: 'var(--danger-soft)', display: 'block', marginBottom: '4px' }}>Alerta enviado</strong>
            <span className="zr-meta" style={{ color: 'var(--danger-soft)', opacity: 0.8 }}>
              {emergencyContactMissing
                ? 'Central SOS registada. Define um contacto de emergência para activar SMS e chamada.'
                : 'Contacto de emergência notificado'}
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
            <span style={{ marginRight: '8px' }}>✅</span>
            Áudio de evidência guardado
          </div>
        )}

        <div className="zr-inline" style={{ gap: '8px' }}>
          <a href="tel:113" className="zr-button zr-button--danger zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px' }}>
            📞 Ligar 113
          </a>
          <a href="tel:112" className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px', color: 'var(--danger-soft)', borderColor: 'var(--danger-soft)' }}>
            📞 Ligar 112
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
            <p>O SOS continua a guardar e difundir o alerta, mas sem SMS nem chamada automática.</p>
          </div>
        </div>
      )}

      <button
        onClick={() => void triggerPanic(false)}
        className={`zr-button zr-button--block ${pressed ? 'zr-button--danger animate-pulse' : 'zr-button--secondary'}`}
        style={pressed ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)' } : { color: 'var(--danger-soft)', borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
      >
        {pressed ? '🆘 CONFIRMA - toca de novo para enviar alerta' : '🛡️ Botão de Pânico (SOS)'}
      </button>
    </div>
  );
}
