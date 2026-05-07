// =============================================================================
// MultiStopInput.tsx — Opção de segundo destino próximo (+500 Kz)
// Permite que 2 amigos partilhem corrida com 2 pontos de drop-off
// =============================================================================
import React, { useState } from 'react';
import { mapService } from '../../services/mapService';
import type { LatLng } from '../../types';

interface MultiStopInputProps {
  destCoords: LatLng | null;
  onExtraDropSet: (address: string, coords: LatLng) => void;
  onExtraDropClear: () => void;
}

const MAX_EXTRA_DISTANCE_KM = 1.0;
const EXTRA_DROP_FEE = 500;

export default function MultiStopInput({ destCoords, onExtraDropSet, onExtraDropClear }: MultiStopInputProps) {
  const [expanded, setExpanded] = useState(false);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = async () => {
    if (!address.trim() || !destCoords) return;
    setLoading(true);
    setError(null);

    try {
      const coords = await mapService.geocodeAddress(address);
      if (!coords) { setError('Morada não encontrada.'); return; }

      // Verificar distância ao destino principal
      const distKm = mapService.calculateDistance(destCoords, coords);
      if (distKm > MAX_EXTRA_DISTANCE_KM) {
        setError(`Endereço demasiado longe (${distKm.toFixed(1)} km). Peça uma corrida separada ou peça para que fiques no local mais próximo e seguro por favor.`);
        return;
      }

      onExtraDropSet(address, coords);
      setConfirmed(true);
    } catch {
      setError('Erro ao verificar morada. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setConfirmed(false);
    setAddress('');
    setError(null);
    onExtraDropClear();
  };

  if (confirmed) {
    return (
      <div style={{
        background: 'rgba(255,170,0,0.08)',
        border: '1px solid rgba(255,170,0,0.2)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
      }}>
        <div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>🚶‍♂️ Segundo destino</span>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#ffaa00' }}>📍 {address}</p>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>+{EXTRA_DROP_FEE} Kz para o motorista</span>
        </div>
        <button onClick={handleClear} style={{
          background: 'none', border: 'none', color: 'var(--danger-soft, #ef4444)',
          cursor: 'pointer', fontSize: 18, padding: 4,
        }}>×</button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        disabled={!destCoords}
        style={{
          width: '100%',
          marginTop: 12,
          padding: '10px 16px',
          borderRadius: 12,
          border: '1px dashed rgba(255,170,0,0.3)',
          background: 'transparent',
          color: destCoords ? '#ffaa00' : 'rgba(255,255,255,0.3)',
          fontSize: 12,
          fontWeight: 600,
          cursor: destCoords ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>+</span>
        Deixar amigo perto (+{EXTRA_DROP_FEE} Kz)
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 12,
      padding: 16,
      borderRadius: 12,
      border: '1px solid rgba(255,170,0,0.2)',
      background: 'rgba(0,0,0,0.3)',
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#ffaa00', fontWeight: 700 }}>
        🚶‍♂️ Segundo destino (max {MAX_EXTRA_DISTANCE_KM} km do destino)
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
        O motorista deixa primeiro no ponto A e depois vai ao ponto B. Custo extra: +{EXTRA_DROP_FEE} Kz.
      </p>

      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Morada do amigo (ex: Rua do Miramar)"
        className="zr-input"
        style={{ marginBottom: 8 }}
      />

      {error && (
        <p style={{ margin: '0 0 8px', fontSize: 11, color: '#ef4444' }}>⚠️ {error}</p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => { setExpanded(false); setAddress(''); setError(null); }}
          className="zr-button zr-button--secondary"
          style={{ flex: 1, padding: '8px 0', fontSize: 11 }}
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading || !address.trim()}
          className="zr-button"
          style={{ flex: 2, padding: '8px 0', fontSize: 11 }}
        >
          {loading ? 'A verificar...' : `Confirmar (+${EXTRA_DROP_FEE} Kz)`}
        </button>
      </div>
    </div>
  );
}
