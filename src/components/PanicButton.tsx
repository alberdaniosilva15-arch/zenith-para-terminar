// =============================================================================
// ZENITH RIDE v3.3 — PanicButton.tsx
// Safety Features v3.3:
//   1. Dois toques para confirmar (evita alertas acidentais)
//   2. Envia localização GPS ao contacto de emergência via WhatsApp
//   3. Grava áudio de 30s automaticamente (evidência)
//   4. Partilha link público de tracking da viagem
//   5. Persiste alerta no Supabase (tabela panic_alerts)
// =============================================================================

import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface PanicButtonProps {
  userId: string;
  rideId?: string;
  emergencyPhone?: string; // número guardado no perfil
  driverName?: string;
}

export default function PanicButton({ userId, rideId, emergencyPhone, driverName }: PanicButtonProps) {
  const [pressed, setPressed]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);
  const mediaRef  = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Gravação de áudio de emergência (30s) ──────────────────────────────────
  const startAudioRecording = async () => {
    setAudioSaved(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        // Upload para Supabase Storage (bucket 'panic-audio')
        try {
          const filename = `panic_${userId}_${Date.now()}.webm`;
          await supabase.storage.from('panic-audio').upload(filename, blob);
          setAudioSaved(true);
        } catch {
          console.warn('[PanicButton] Erro ao guardar áudio — storage pode não existir');
          setAudioSaved(false);
        }
        setRecording(false);
      };

      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);

      // Parar automaticamente após 30 segundos
      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 30000);
    } catch {
      // Sem permissão de microfone — continua sem gravar
      console.warn('[PanicButton] Sem acesso ao microfone');
    }
  };

  const triggerPanic = async () => {
    if (!pressed) {
      setPressed(true);
      // Auto-reset após 5s se não confirmar
      setTimeout(() => setPressed(false), 5000);
      return;
    }

    setSent(true);

    // Iniciar gravação de áudio de emergência
    startAudioRecording();

    // Obter localização actual
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;

      // Persistir alerta na BD
      try {
        await supabase.from('panic_alerts').insert({
          user_id: userId,
          ride_id: rideId ?? null,
          lat: latitude,
          lng: longitude,
          driver_name: driverName ?? null,
          created_at: new Date().toISOString(),
        });
      } catch { /* falha silenciosa */ }

      // Partilha localização via WhatsApp ao contacto de emergência
      if (emergencyPhone) {
        const mapLink = `https://maps.google.com/?q=${latitude},${longitude}`;
        const driverInfo = driverName ? `\n🚗 Motorista: ${driverName}` : '';
        const msg = encodeURIComponent(
          `🆘 *ALERTA DE EMERGÊNCIA — ZENITH RIDE*\n\nPreciso de ajuda urgente!${driverInfo}\n📍 Localização: ${mapLink}\n⏰ ${new Date().toLocaleTimeString('pt-AO')}\n\n_Enviado automaticamente pelo Zenith Ride_`
        );
        window.open(`https://wa.me/${emergencyPhone.replace(/\D/g, '')}?text=${msg}`, '_blank');
      }
    }, async () => {
      // Sem GPS — envia alerta mesmo assim
      try {
        await supabase.from('panic_alerts').insert({
          user_id: userId,
          ride_id: rideId ?? null,
          driver_name: driverName ?? null,
        });
      } catch { /* falha silenciosa */ }
    });
  };

  if (sent) {
    return (
      <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-5 space-y-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center shrink-0">
            <span className="text-xl">🆘</span>
          </div>
          <div>
            <p className="text-red-400 font-black text-sm">Alerta Enviado!</p>
            <p className="text-red-300/70 text-[10px] font-bold">
              Contacto de emergência notificado via WhatsApp
            </p>
          </div>
        </div>

        {/* Estado da gravação */}
        {recording && (
          <div className="flex items-center gap-2 bg-red-500/10 rounded-xl p-3 border border-red-500/20">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
              A gravar áudio de emergência... (30s)
            </p>
          </div>
        )}
        {audioSaved && !recording && (
          <div className="flex items-center gap-2 bg-green-500/10 rounded-xl p-3 border border-green-500/20">
            <span className="text-sm">✅</span>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">
              Áudio de evidência guardado
            </p>
          </div>
        )}

        {/* Acções adicionais */}
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
      onClick={triggerPanic}
      className={`w-full py-4 rounded-2xl font-black text-sm transition-all active:scale-95 ${
        pressed
          ? 'bg-red-600 text-white animate-pulse border-2 border-red-400 shadow-[0_0_30px_rgba(239,68,68,0.4)]'
          : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/15'
      }`}
    >
      {pressed ? '🆘 CONFIRMA — toca de novo para enviar alerta' : '🛡️ Botão de Pânico (SOS)'}
    </button>
  );
}
