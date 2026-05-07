// =============================================================================
// ZENITH RIDE v3.0 — src/components/ZonePriceMap.tsx
//
// Tabela de preços fixos por zona — visível para passageiros E motoristas.
// Elimina a percepção de surge pricing arbitrário.
// A empresa define os preços → confiança dos dois lados.
//
// Integração:
//   1. Adicionar tab 'precos' ao Layout.tsx (TabType)
//   2. Renderizar <ZonePriceMap /> no App.tsx quando activeTab === 'precos'
//   OU mostrar dentro do PassengerHome quando o passageiro selecciona destino.
// =============================================================================

import React, { useState, useEffect } from 'react';
import { zonePriceService, ZONE_COLORS } from '../services/zonePrice';
import type { ZonePrice } from '../types';

const ALL_ZONES = Object.keys(ZONE_COLORS);

const ZonePriceMap: React.FC<{
  highlightOrigin?: string;   // zona de origem pré-selecionada (ex: ao seleccionar pickup)
  highlightDest?:   string;   // zona de destino pré-selecionada
  compact?:         boolean;  // versão compacta para embeder no PassengerHome
}> = ({ highlightOrigin, highlightDest, compact = false }) => {
  const [prices,       setPrices]       = useState<ZonePrice[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [originFilter, setOriginFilter] = useState<string>(highlightOrigin ?? 'Centro');

  useEffect(() => {
    zonePriceService.getAllPrices().then(p => {
      setPrices(p);
      setLoading(false);
    });
  }, []);

  const filteredPrices = prices.filter(p =>
    p.origin_zone === originFilter || p.dest_zone === originFilter
  ).map(p => ({
    zone:        p.origin_zone === originFilter ? p.dest_zone : p.origin_zone,
    price_kz:    p.price_kz,
    distance_km: p.distance_km,
    isHighlight: p.dest_zone === highlightDest || p.origin_zone === highlightDest,
  }))
  // Deduplicar — evita zona aparecer duas vezes em preços bidirecionais
  .filter((item, idx, arr) => arr.findIndex(x => x.zone === item.zone) === idx)
  .sort((a, b) => a.price_kz - b.price_kz);

  if (loading) {
    return (
      <div className={compact ? '' : 'zr-app'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: compact ? 'auto' : '60vh', padding: '32px 0' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  return (
    <div className={compact ? '' : 'zr-app'} style={compact ? {} : { minHeight: '100vh', paddingBottom: '120px' }}>

      {!compact && (
        <header className="zr-header">
          <div className="zr-inline zr-inline--between">
            <div>
              <p className="zr-kicker">Sem surpresas · Sem surge</p>
              <h2 className="zr-section-title">Preços Fixos</h2>
            </div>
            <span className="zr-chip zr-chip--gold">Garantido</span>
          </div>
        </header>
      )}

      <div style={compact ? {} : { padding: '14px' }}>
        {/* ── Selector de zona de origem ─────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          {!compact && (
            <p className="zr-label" style={{ marginBottom: '8px' }}>Estou em</p>
          )}
          <div className="zr-scroll-x">
            {ALL_ZONES.map(zone => {
              const active = originFilter === zone;
              return (
                <button
                  key={zone}
                  onClick={() => setOriginFilter(zone)}
                  className={`zr-tab ${active ? 'is-active' : ''}`}
                >
                  {zone}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Grid de preços ─────────────────────────────────────────────── */}
        {filteredPrices.length === 0 ? (
          <div className="zr-empty">
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '16px' }}>location_disabled</span>
            <p className="zr-copy">Nenhum preço configurado para {originFilter}</p>
          </div>
        ) : (
          <div className="zr-list" style={{ marginBottom: '24px' }}>
            {filteredPrices.map((item, idx) => {
              return (
                <div
                  key={`${item.zone}-${idx}`}
                  className="zr-list-item"
                  style={item.isHighlight ? { border: '1px solid var(--gold)' } : {}}
                >
                  <div>
                    <strong style={{ display: 'block', color: item.isHighlight ? 'var(--gold)' : 'inherit' }}>{item.zone}</strong>
                    <span className="zr-meta">~{item.distance_km} km</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong style={{ display: 'block' }}>{item.price_kz.toLocaleString('pt-AO')} Kz</strong>
                    {item.isHighlight && (
                      <span className="zr-meta" style={{ color: 'var(--gold)' }}>Seleccionado</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Nota de transparência ─────────────────────────────────────── */}
        {!compact && (
          <div className="zr-alert-box zr-alert-box--success">
            <div className="zr-alert-content">
              <strong>Preço que vês = preço que pagas</strong>
              <p style={{ marginTop: '4px' }}>Os preços são fixos por zona e não mudam com a hora ou a procura. Podes confiar no que está aqui.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ZonePriceMap;
