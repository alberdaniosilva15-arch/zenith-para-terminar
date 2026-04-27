import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface PanicButtonProps {
  userId: string;
  rideId?: string;
  emergencyPhone?: string;
  driverName?: string;
  counterpartyName?: string;
  counterpartyLabel?: string;
  silentSignal?: number;
}

export default function PanicButton({
  userId,
  rideId,
  emergencyPhone,
  driverName,
  counterpartyName,
  counterpartyLabel = 'Motorista',
  silentSignal,
}: PanicButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [sent, setSent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSilentSignalRef = useRef<number | undefined>(silentSignal);
  const activeAlertIdRef = useRef<string | null>(null);

  const resolvedCounterparty = counterpartyName ?? driverName;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (confirmResetRef.current) {
        clearTimeout(confirmResetRef.current);
      }
      if (mediaRef.current?.state === 'recording') {
        mediaRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (silentSignal == null || silentSignal === lastSilentSignalRef.current) {
      return;
    }

    lastSilentSignalRef.current = silentSignal;
    void triggerPanic(true);
  }, [silentSignal]);

  const startAudioRecording = async (silent: boolean) => {
    if (!silent) {
      setAudioSaved(false);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
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
        } catch {
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
      recorder.start();

      if (!silent) {
        setRecording(true);
      }

      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 30000);
    } catch {
      console.warn('[PanicButton] Sem acesso ao microfone.');
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
      return data?.id ?? null;
    } catch {
      // Falha silenciosa para nunca bloquear o SOS.
      activeAlertIdRef.current = null;
      return null;
    }
  };

  const sendWhatsAppAlert = (latitude?: number, longitude?: number) => {
    if (!emergencyPhone) {
      return;
    }

    const normalizedPhone = emergencyPhone.replace(/\D/g, '');
    const phoneWithCountry = normalizedPhone.startsWith('244')
      ? normalizedPhone
      : `244${normalizedPhone}`;

    const locationText = typeof latitude === 'number' && typeof longitude === 'number'
      ? `📍 Localizacao: https://maps.google.com/?q=${latitude},${longitude}\n`
      : '';

    const counterpartyText = resolvedCounterparty
      ? `🚨 ${counterpartyLabel}: ${resolvedCounterparty}\n`
      : '';

    const message = encodeURIComponent(
      `🆘 ALERTA DE EMERGENCIA - ZENITH RIDE\n\n` +
      `Preciso de ajuda urgente.\n` +
      `${counterpartyText}${locationText}` +
      `⏰ ${new Date().toLocaleTimeString('pt-AO')}\n\n` +
      `_Enviado automaticamente pelo Zenith Ride_`,
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank', 'noopener,noreferrer');
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
    }

    void startAudioRecording(silent);
    activeAlertIdRef.current = null;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await persistPanic(latitude, longitude, silent ? 'critical' : 'high');
        sendWhatsAppAlert(latitude, longitude);
      },
      async () => {
        await persistPanic(undefined, undefined, silent ? 'critical' : 'high');
        sendWhatsAppAlert();
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
      <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-5 space-y-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center shrink-0">
            <span className="text-xl">🆘</span>
          </div>
          <div>
            <p className="text-red-400 font-black text-sm">Alerta enviado</p>
            <p className="text-red-300/70 text-[10px] font-bold">
              Contacto de emergencia notificado via WhatsApp
            </p>
          </div>
        </div>

        {recording && (
          <div className="flex items-center gap-2 bg-red-500/10 rounded-xl p-3 border border-red-500/20">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
              A gravar audio de emergencia... (30s)
            </p>
          </div>
        )}

        {audioSaved && !recording && (
          <div className="flex items-center gap-2 bg-green-500/10 rounded-xl p-3 border border-green-500/20">
            <span className="text-sm">✅</span>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">
              Audio de evidencia guardado
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <a
            href="tel:113"
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest text-center active:scale-95 transition-all"
          >
            📞 Ligar 113
          </a>
          <a
            href="tel:112"
            className="flex-1 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl font-black text-[10px] uppercase tracking-widest text-center active:scale-95 transition-all"
          >
            📞 Ligar 112
          </a>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => void triggerPanic(false)}
      className={`w-full py-4 rounded-2xl font-black text-sm transition-all active:scale-95 ${
        pressed
          ? 'bg-red-600 text-white animate-pulse border-2 border-red-400 shadow-[0_0_30px_rgba(239,68,68,0.4)]'
          : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/15'
      }`}
    >
      {pressed ? '🆘 CONFIRMA - toca de novo para enviar alerta' : '🛡️ Botao de Panico (SOS)'}
    </button>
  );
}
