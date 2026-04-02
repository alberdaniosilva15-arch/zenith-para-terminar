// =============================================================================
// ZENITH RIDE — Layout.tsx — MFUMU ZENITH EDITION
// Header + Nav com design "The Digital Gilded Age"
// =============================================================================

import React from 'react';
import { UserRole, TabType } from '../types';

interface LayoutProps {
  children:          React.ReactNode;
  role:              UserRole;
  activeTab:         TabType;
  onTabChange:       (tab: TabType) => void;
  dataSaver:         boolean;
  onDataSaverToggle: () => void;
  kazeSilent:        boolean;
  onKazeSilentToggle:() => void;
  userName?:         string;
  userRating?:       number;
}

const TAB_ICONS: Record<TabType, string> = {
  home:     'bolt',
  social:   'explore',
  contrato: 'description',
  rides:    'route',
  wallet:   'account_balance_wallet',
  profile:  'person',
  precos:   'price_check',
};

const Layout: React.FC<LayoutProps> = ({
  children, role, activeTab, onTabChange,
  dataSaver, onDataSaverToggle, kazeSilent, onKazeSilentToggle,
  userName, userRating,
}) => {
  const isDriver = role === UserRole.DRIVER;
  const isAdmin  = role === UserRole.ADMIN;

  const tabs: TabType[] = isDriver
    ? ['home', 'social', 'rides', 'wallet', 'profile']
    : ['home', 'social', 'precos', 'contrato', 'rides', 'wallet', 'profile'];

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto relative overflow-hidden bg-[#0B0B0B]">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-[#0A0A0A] flex justify-between items-center w-full px-5 py-4 fixed top-0 z-50 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="px-4 py-1.5 golden-gradient rounded-full font-headline font-bold text-sm shadow-glow gold-box-glow tracking-tighter italic">
            Zenith Ride
          </div>
          {isAdmin && (
            <span className="text-[8px] text-primary font-black uppercase tracking-[0.2em] border border-primary/30 px-2 py-0.5 rounded-full">
              MFUMU CORE
            </span>
          )}
        </div>

        {/* Right: status + settings */}
        <div className="flex items-center gap-3">
          {userRating && (
            <span className="text-[9px] font-black text-primary/70 font-label uppercase tracking-widest">
              ⭐ {userRating.toFixed(1)}
            </span>
          )}

          {/* Data saver toggle */}
          <button
            onClick={onDataSaverToggle}
            title={dataSaver ? 'Modo dados activo' : 'Activar modo dados'}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all luxury-transition ${
              dataSaver ? 'bg-primary/20 text-primary' : 'text-on-surface-variant'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: dataSaver ? "'FILL' 1" : "'FILL' 0" }}>
              signal_cellular_alt
            </span>
          </button>

          {/* Kaze silent toggle */}
          <button
            onClick={onKazeSilentToggle}
            title={kazeSilent ? 'Kaze silenciado' : 'Kaze activo'}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all luxury-transition ${
              kazeSilent ? 'text-on-surface-variant/40' : 'text-primary'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: kazeSilent ? "'FILL' 0" : "'FILL' 1" }}>
              smart_toy
            </span>
          </button>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto no-scrollbar pt-16 pb-24">
        {children}
      </main>

      {/* ── Bottom Nav (oculta no Admin) ─────────────────────────── */}
      {!isAdmin && (
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 bg-[#000000] border-t border-primary/30 flex justify-around items-center h-20 px-4">
          {tabs.map(tab => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 luxury-transition relative ${
                  active ? 'text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/60'
                }`}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 24,
                    fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                  }}
                >
                  {TAB_ICONS[tab]}
                </span>
                {active && (
                  <span className="w-1 h-1 rounded-full bg-primary absolute bottom-1 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};

export default Layout;
