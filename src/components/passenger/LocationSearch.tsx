import React from 'react';
import { LocationResult } from '../../types';

interface LocationSearchProps {
  selecting: 'pickup' | 'dest';
  searchQuery: string;
  results: LocationResult[];
  searching: boolean;
  userLocation: { lat: number; lng: number } | null;
  onSearchChange: (query: string) => void;
  onClose: () => void;
  onUseGPS: () => void;
  onSelectLocation: (loc: LocationResult) => void;
}

// Haversine rápido para mostrar distância aproximada na lista
function quickDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTypeIcon(type: LocationResult['type']): string {
  switch (type) {
    case 'bairro':    return '🏘️';
    case 'hospital':  return '🏥';
    case 'servico':   return '🏪';
    case 'monumento': return '🏛️';
    case 'rua':       return '🛣️';
    default:          return '📍';
  }
}

const LocationSearch: React.FC<LocationSearchProps> = ({
  selecting,
  searchQuery,
  results,
  searching,
  userLocation,
  onSearchChange,
  onClose,
  onUseGPS,
  onSelectLocation,
}) => {
  return (
    <div className="zr-app" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Localização</p>
            <h2 className="zr-section-title">{selecting === 'pickup' ? 'De onde partes?' : 'Para onde vais?'}</h2>
          </div>
          <button className="zr-button zr-button--sm zr-button--ghost" onClick={onClose}>Cancelar</button>
        </div>
      </header>

      <div style={{ padding: '14px' }}>
        <input 
          autoFocus
          className="zr-input" 
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={selecting === 'pickup' ? 'Nome do local de partida' : 'Nome do destino'} 
          style={{ width: '100%', marginBottom: '14px' }}
        />

        <p className="zr-copy" style={{ marginBottom: '14px' }}>
          {searching
            ? 'A pesquisar...'
            : results.length > 0
              ? `${results.length} locais encontrados`
              : searchQuery.length >= 2
                ? 'Nenhum resultado — tenta outro nome'
                : 'Escreve o nome do bairro, rua ou local'}
        </p>

        <div className="zr-list">
          {selecting === 'pickup' && (
            <button className="zr-list-item zr-list-item--interactive" onClick={onUseGPS} disabled={searching} style={{ textAlign: 'left', width: '100%' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '24px', color: 'var(--primary)' }}>my_location</span>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block' }}>Usar localização actual</strong>
                <span className="zr-copy">GPS do dispositivo</span>
              </div>
            </button>
          )}

          {results.map((res, i) => {
            const distKm = userLocation ? quickDistanceKm(userLocation.lat, userLocation.lng, res.coords.lat, res.coords.lng) : null;
            return (
              <button key={`location-${res.name}-${i}`} onClick={() => onSelectLocation(res)} className="zr-list-item zr-list-item--interactive" style={{ textAlign: 'left', width: '100%' }}>
                <span style={{ fontSize: '24px' }}>{getTypeIcon(res.type)}</span>
                <div style={{ flex: 1 }}>
                  <strong style={{ display: 'block' }}>{res.name}</strong>
                  <span className="zr-copy">{res.description}</span>
                </div>
                {distKm !== null && (
                  <span className="zr-chip zr-chip--muted">{distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)} km`}</span>
                )}
                {res.isPopular && (
                  <span className="zr-chip zr-chip--gold" style={{ marginLeft: '8px' }}>Popular</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  );
};

export default LocationSearch;
