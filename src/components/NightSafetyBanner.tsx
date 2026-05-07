// =============================================================================
// NightSafetyBanner.tsx — Aviso nocturno automático (18h-4:59h)
// Recomenda activar segurança: partilha de localização + modo escuta
// =============================================================================
import React, { useState, useEffect } from 'react';

interface NightSafetyBannerProps {
  hasEmergencyContact: boolean;
  hasActiveRide: boolean;
  safetyContextKey?: string | null;
  onActivateSafety: () => void;
}

export default function NightSafetyBanner({
  hasEmergencyContact,
  hasActiveRide,
  safetyContextKey,
  onActivateSafety,
}: NightSafetyBannerProps) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activatedContext, setActivatedContext] = useState<string | null>(null);

  useEffect(() => {
    const checkHour = () => {
      const hour = new Date().getHours();
      setVisible((hour >= 18 || hour < 5) && hasActiveRide);
    };
    checkHour();
    const interval = setInterval(checkHour, 60_000);
    return () => clearInterval(interval);
  }, [hasActiveRide]);

  useEffect(() => {
    if (!safetyContextKey) return;
    setDismissed(false);
  }, [safetyContextKey]);

  if (!visible || dismissed || (safetyContextKey && activatedContext === safetyContextKey)) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,170,0,0.15), rgba(255,68,68,0.1))',
      border: '1px solid rgba(255,170,0,0.3)',
      borderRadius: 16,
      padding: '16px 20px',
      marginBottom: 16,
      position: 'relative',
    }}>
      <button 
        onClick={() => setDismissed(true)}
        style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 18 }}
      >×</button>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 28 }}>🌙</span>
        <div>
          <strong style={{ color: '#ffaa00', fontSize: 14, display: 'block' }}>Modo Nocturno Activo</strong>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
            Recomendamos activar a segurança reforçada entre as 18h e as 5h.
          </span>
        </div>
      </div>

      {hasEmergencyContact ? (
        <button
          onClick={() => {
            onActivateSafety();
            setActivatedContext(safetyContextKey ?? 'default');
          }}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 12,
            border: '1px solid rgba(255,170,0,0.4)',
            background: 'rgba(255,170,0,0.15)',
            color: '#ffaa00',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            letterSpacing: 1,
            textTransform: 'uppercase' as const,
          }}
        >
          🛡️ Activar Partilha de Localização ao Vivo
        </button>
      ) : (
        <p style={{ color: 'rgba(255,68,68,0.8)', fontSize: 11, margin: 0, textAlign: 'center' }}>
          ⚠️ Adiciona um contacto de emergência em Perfil → Segurança para activar esta funcionalidade.
        </p>
      )}
    </div>
  );
}
