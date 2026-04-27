// =============================================================================
// ZENITH RIDE v3.5 — LiveShareButton.tsx
// Kaze Safety Shield — Partilha ao Vivo durante corrida activa
//
// Funcionalidades:
//   1. Gera link público com tracking ao vivo da corrida
//   2. Abre WhatsApp com link + nome do motorista para contacto de emergência
//   3. Cria partilha pública própria para rides (sem reutilizar tabela escolar)
//   4. Tudo que o passageiro precisa: 1 toque → link partilhado
// =============================================================================

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface LiveShareButtonProps {
  rideId: string;
  userId: string;
  driverName?: string;
  emergencyPhone?: string; // número do contacto de emergência no perfil
  pickup?: string;
  destination?: string;
}

export const LiveShareButton: React.FC<LiveShareButtonProps> = ({
  rideId,
  userId,
  driverName,
  emergencyPhone,
  pickup,
  destination,
}) => {
  const [loading, setLoading]     = useState(false);
  const [shared,  setShared]      = useState(false);
  const [link,    setLink]        = useState<string | null>(null);

  const handleShare = async () => {
    if (shared && link) {
      // Já partilhou — copiar/re-partilhar o link existente
      doShare(link);
      return;
    }

    setLoading(true);
    try {
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 horas

      const { data, error } = await supabase.from('ride_tracking_shares').insert({
        ride_id:       rideId,
        owner_user_id: userId,
        status:        'active',
        expires_at:    expiresAt,
      }).select('public_token').single();

      if (error || !data?.public_token) {
        throw error ?? new Error('Não foi possível gerar o token de rastreio.');
      }

      // Construir link público
      const appBase = window.location.origin;
      const shareLink = `${appBase}/track/${data.public_token}`;
      setLink(shareLink);
      setShared(true);

      doShare(shareLink);
    } catch (e) {
      console.warn('[LiveShareButton] Erro ao criar sessão de tracking:', e);
      // Fallback: partilhar posição via WhatsApp sem link de tracking
      doShareFallback();
    } finally {
      setLoading(false);
    }
  };

  const doShare = (shareLink: string) => {
    const driverInfo = driverName ? `🚗 Motorista: *${driverName}*\n` : '';
    const routeInfo  = (pickup && destination)
      ? `📍 ${pickup} → ${destination}\n`
      : '';

    const message = encodeURIComponent(
      `🛡️ *ZENITH RIDE — Estou numa corrida*\n\n` +
      `${driverInfo}${routeInfo}\n` +
      `Segue a minha viagem em tempo real aqui:\n👉 ${shareLink}\n\n` +
      `_Este link expira em 4 horas. Enviado por Zenith Ride Kaze Safety Shield._`
    );

    // Tentar partilha nativa primeiro (mobile)
    if (navigator.share) {
      navigator.share({
        title: 'Zenith Ride — A minha corrida ao vivo',
        text:  `🛡️ Segue a minha viagem: ${shareLink}`,
        url:   shareLink,
      }).catch(() => {
        // Utilizador cancelou ou falhou — fallback WhatsApp
        openWhatsApp(message);
      });
    } else if (emergencyPhone) {
      openWhatsApp(message);
      } else {
        // Copiar para clipboard
        navigator.clipboard.writeText(shareLink).catch(() => {});
      }
  };

  const doShareFallback = () => {
    // Sem link de tracking — partilhar apenas aviso de emergência
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      const mapLink = `https://maps.google.com/?q=${latitude},${longitude}`;
      const driverInfo = driverName ? `🚗 Motorista: *${driverName}*\n` : '';
      const message = encodeURIComponent(
        `⚠️ *ZENITH RIDE — Estou numa corrida*\n\n${driverInfo}` +
        `📍 A minha localização actual: ${mapLink}\n\n` +
        `_Enviado via Zenith Ride Safety Shield_`
      );
      if (emergencyPhone) openWhatsApp(message);
      else if (navigator.share) {
        navigator.share({ title: 'A minha localização', url: mapLink }).catch(() => {});
      }
    }, () => {
      // Sem GPS — copiar link de WhatsApp genérico
      if (emergencyPhone) {
        const msg = encodeURIComponent(`⚠️ Estou numa corrida Zenith Ride. Motorista: ${driverName ?? 'desconhecido'}.`);
        openWhatsApp(msg);
      }
    });
  };

  const openWhatsApp = (message: string) => {
    const phone = emergencyPhone
      ? emergencyPhone.replace(/\D/g, '')
      : '';
    const url = phone
      ? `https://wa.me/244${phone}?text=${message}`
      : `https://wa.me/?text=${message}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleShare}
        disabled={loading}
        className={`w-full py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 ${
          shared
            ? 'bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/15'
            : 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/15'
        } disabled:opacity-60`}
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            A gerar link...
          </>
        ) : shared ? (
          <>
            <span>✅</span>
            Partilhado! Toca para re-enviar
          </>
        ) : (
          <>
            <span>📡</span>
            Partilhar Corrida ao Vivo
            {emergencyPhone && <span className="opacity-60">· WhatsApp</span>}
          </>
        )}
      </button>

      {shared && link && (
        <div
          className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 flex items-center gap-3 cursor-pointer active:scale-95 transition-all"
          onClick={() => navigator.clipboard.writeText(link).catch(() => {})}
        >
          <span className="text-sm shrink-0">🔗</span>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-green-400 mb-0.5">Link activo · Toca para copiar</p>
            <p className="text-[9px] text-on-surface-variant/60 font-mono truncate">{link}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveShareButton;
