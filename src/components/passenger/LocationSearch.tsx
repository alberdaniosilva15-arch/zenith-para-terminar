import React from 'react';
import { LocationResult } from '../../types';

interface LocationSearchProps {
  selecting: 'pickup' | 'dest';
  searchQuery: string;
  results: LocationResult[];
  searching: boolean;
  onSearchChange: (query: string) => void;
  onClose: () => void;
  onUseGPS: () => void;
  onSelectLocation: (loc: LocationResult) => void;
}

const LocationSearch: React.FC<LocationSearchProps> = ({
  selecting,
  searchQuery,
  results,
  searching,
  onSearchChange,
  onClose,
  onUseGPS,
  onSelectLocation,
}) => {
  return (
    <div className="absolute inset-x-4 top-4 z-[100] animate-in slide-in-from-top duration-300 flex flex-col max-h-[85vh]">
      <div className="bg-surface-container-low rounded-[2.5rem] overflow-hidden border border-outline-variant/20 flex flex-col shadow-2xl">
        <div className="p-5 border-b border-outline-variant/10 flex items-center gap-4 sticky top-0 bg-surface-container-low z-10">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-surface-container-lowest rounded-full text-outline font-black"
          >✕</button>
          <input
            autoFocus
            type="text"
            placeholder={selecting === 'pickup' ? 'De onde partes?' : 'Para onde vais?'}
            className="flex-1 bg-surface-container-lowest p-4 rounded-2xl outline-none font-black text-sm text-on-surface"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {selecting === 'pickup' && (
            <button onClick={onUseGPS} disabled={searching}
              className="w-full flex items-center gap-4 p-4 bg-primary/10 rounded-2xl border border-primary/20 mb-2 text-left disabled:opacity-60">
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white text-lg">
                {searching ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '📍'}
              </div>
              <div>
                <p className="font-black text-on-surface text-sm">Usar a minha localização</p>
                <p className="text-[9px] text-primary font-bold uppercase">GPS automático · Nome do bairro</p>
              </div>
            </button>
          )}
          <p className="px-4 text-[8px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">
            {searching ? 'A consultar...' : `${results.length} locais`}
          </p>
          {results.map((res, i) => (
            <button key={`location-${res.name}-${i}`} onClick={() => onSelectLocation(res)}
              className="w-full flex items-center gap-4 p-4 hover:bg-surface-container-lowest rounded-2xl transition-colors text-left border border-transparent hover:border-outline-variant/20">
              <div className="w-10 h-10 bg-surface-container-low rounded-xl flex items-center justify-center text-xl shrink-0">
                {res.type === 'bairro' ? '🏘️' : res.type === 'hospital' ? '🏥' : res.type === 'servico' ? '🏪' : res.type === 'monumento' ? '🏛️' : '📍'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-on-surface text-sm truncate">{res.name}</p>
                <p className="text-[9px] font-bold text-on-surface-variant/70 uppercase">{res.description}</p>
              </div>
              {res.isPopular && (
                <span className="text-[8px] bg-primary/15 text-primary px-2 py-1 rounded-full font-black shrink-0">Popular</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LocationSearch;
