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
    let phone = emergencyPhone
      ? emergencyPhone.replace(/\D/g, '')
      : '';
    if (phone && !phone.startsWith('244')) {
      phone = `244${phone}`;
    }
    const url = phone
      ? `https://wa.me/${phone}?text=${message}`
      : `https://wa.me/?text=${message}`;
    window.open(url, '_blank');
  };

  return (
    <div style={{ marginTop: '8px' }}>
      <button
        onClick={handleShare}
        disabled={loading}
        className={`zr-button zr-button--block ${
          shared ? 'zr-button--success' : 'zr-button--secondary'
        }`}
      >
        {loading ? (
          <>A gerar link...</>
        ) : shared ? (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '8px' }}>check_circle</span>
            Partilhado! Toca para re-enviar
          </>
        ) : (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '8px' }}>sensors</span>
            Partilhar Corrida ao Vivo
            {emergencyPhone && <span style={{ opacity: 0.6 }}> · WhatsApp</span>}
          </>
        )}
      </button>

      {shared && link && (
        <div
          className="zr-alert-box"
          style={{ marginTop: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' }}
          onClick={() => navigator.clipboard.writeText(link).catch(() => {})}
        >
          <span className="material-symbols-outlined" style={{ color: '#22c55e' }}>link</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="zr-kicker" style={{ color: '#22c55e' }}>Link activo · Toca para copiar</p>
            <p className="zr-copy" style={{ opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>{link}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveShareButton;
