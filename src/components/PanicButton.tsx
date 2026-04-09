import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface PanicButtonProps {
  userId: string;
  rideId?: string;
  emergencyPhone?: string; // número guardado no perfil
}

export default function PanicButton({ userId, rideId, emergencyPhone }: PanicButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [sent, setSent] = useState(false);

  const triggerPanic = async () => {
    if (!pressed) { setPressed(true); return; } // 1º toque = confirmação
    setSent(true);

    // Obter localização actual
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await supabase.from('panic_alerts').insert({
        user_id: userId,
        ride_id: rideId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });

      // Partilha localização via WhatsApp ao contacto de emergência
      if (emergencyPhone) {
        const mapLink = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
        const msg = encodeURIComponent(
          `🆘 *ALERTA ZENITH RIDE*\n\nPreciso de ajuda!\n📍 Localização: ${mapLink}\n\n_Enviado automaticamente pelo Zenith Ride_`
        );
        window.open(`https://wa.me/${emergencyPhone.replace(/\D/g, '')}?text=${msg}`, '_blank');
      }
    }, async () => {
      // Sem GPS — envia alerta mesmo assim
      await supabase.from('panic_alerts').insert({ user_id: userId, ride_id: rideId });
    });
  };

  if (sent) {
    return (
      <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-4 text-center">
        <p className="text-red-400 font-bold text-sm">✅ Alerta enviado!</p>
        <p className="text-red-300/70 text-xs mt-1">Contacto de emergência notificado via WhatsApp.</p>
      </div>
    );
  }

  return (
    <button
      onClick={triggerPanic}
      className={`w-full py-4 rounded-2xl font-black text-sm transition-all active:scale-95 ${
        pressed
          ? 'bg-red-600 text-white animate-pulse border-2 border-red-400'
          : 'bg-red-500/10 text-red-400 border border-red-500/30'
      }`}
    >
      {pressed ? '🆘 CONFIRMA — toca de novo para enviar alerta' : '🛡️ Botão de Pânico'}
    </button>
  );
}
