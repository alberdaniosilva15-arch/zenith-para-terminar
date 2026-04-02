// =============================================================================
// MOTOGO v3.0 — src/components/ZonePriceMap.tsx
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
    zone:       p.origin_zone === originFilter ? p.dest_zone : p.origin_zone,
    price_kz:   p.price_kz,
    distance_km: p.distance_km,
    isHighlight: p.dest_zone === highlightDest || p.origin_zone === highlightDest,
  })).sort((a, b) => a.price_kz - b.price_kz);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={compact ? '' : 'p-4 space-y-5'}>

      {!compact && (
        <div className="px-2">
          <h2 className="text-2xl font-black text-on-surface tracking-tighter italic">
            Preços <span className="text-primary">Fixos</span>
          </h2>
          <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-[0.2em]">
            Sem surpresas · Sem surge · Preço garantido
          </p>
        </div>
      )}

      {/* ── Selector de zona de origem ─────────────────────────────────── */}
      <div>
        {!compact && (
          <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-2 px-1">
            Estou em
          </p>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {ALL_ZONES.map(zone => {
            const color = ZONE_COLORS[zone];
            const active = originFilter === zone;
            return (
              <button
                key={zone}
                onClick={() => setOriginFilter(zone)}
                className={`px-4 py-2 rounded-full text-[9px] font-black uppercase shrink-0 transition-all ${
                  active
                    ? 'bg-surface-container-highest text-white shadow-lg'
                    : `${color.bg} ${color.text}`
                }`}
              >
                {zone}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Grid de preços ─────────────────────────────────────────────── */}
      {filteredPrices.length === 0 ? (
        <p className="text-center text-on-surface-variant/70 text-sm py-8">
          Nenhum preço configurado para {originFilter}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredPrices.map(item => {
            const color = ZONE_COLORS[item.zone] ?? { bg: 'bg-surface-container-lowest', text: 'text-on-surface-variant', label: '' };
            return (
              <div
                key={item.zone}
                className={`flex items-center gap-4 p-4 rounded-[2rem] border transition-all ${
                  item.isHighlight
                    ? 'border-primary/50 bg-primary/10 shadow-sm'
                    : 'border-outline-variant/20 bg-surface-container-low'
                }`}
              >
                {/* Zona destino */}
                <div className={`px-3 py-1.5 rounded-full text-[9px] font-black ${color.bg} ${color.text} shrink-0`}>
                  {item.zone}
                </div>

                {/* Linha tracejada */}
                <div className="flex-1 border-t border-dashed border-outline-variant/30" />

                {/* Distância */}
                <p className="text-[9px] font-bold text-on-surface-variant/70 shrink-0">
                  ~{item.distance_km} km
                </p>

                {/* Preço */}
                <div className="text-right shrink-0">
                  <p className="font-black text-on-surface text-sm">
                    {item.price_kz.toLocaleString('pt-AO')} Kz
                  </p>
                  {item.isHighlight && (
                    <p className="text-[7px] text-primary font-black uppercase">Seleccionado</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Nota de transparência ─────────────────────────────────────── */}
      {!compact && (
        <div className="bg-primary/10 border border-primary/30 rounded-[2rem] p-4 flex gap-3 items-start">
          <span className="text-xl">✅</span>
          <div>
            <p className="text-[10px] font-black text-primary">Preço que vês = preço que pagas</p>
            <p className="text-[9px] text-primary font-bold leading-relaxed">
              Os preços são fixos por zona e não mudam com a hora ou a procura. Podes confiar no que está aqui.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZonePriceMap;
