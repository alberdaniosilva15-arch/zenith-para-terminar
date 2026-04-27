import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TabType, UserRole } from '../types';
import DevQRCode from './DevQRCode';
import RoleSwitcher from './RoleSwitcher';

interface LayoutProps {
  children: React.ReactNode;
  role: UserRole;
  dataSaver: boolean;
  onDataSaverToggle: () => void;
  kazeSilent: boolean;
  onKazeSilentToggle: () => void;
  userName?: string;
  userRating?: number;
}

const TAB_ICONS: Record<TabType, string> = {
  home: 'bolt',
  social: 'explore',
  contrato: 'description',
  rides: 'route',
  wallet: 'account_balance_wallet',
  profile: 'person',
  precos: 'price_check',
};

const TAB_ROUTES: Record<TabType, string> = {
  home: '/',
  social: '/social',
  contrato: '/contrato',
  rides: '/rides',
  wallet: '/wallet',
  profile: '/profile',
  precos: '/precos',
};

const Layout: React.FC<LayoutProps> = ({
  children,
  role,
  dataSaver,
  onDataSaverToggle,
  kazeSilent,
  onKazeSilentToggle,
  userRating,
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isDriver = role === UserRole.DRIVER;
  const isFleetOwner = role === UserRole.FLEET_OWNER;

  const tabs: TabType[] = isFleetOwner
    ? ['home', 'profile']
    : isDriver
      ? ['home', 'social', 'rides', 'wallet', 'profile']
      : ['home', 'social', 'precos', 'contrato', 'rides', 'wallet', 'profile'];

  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col overflow-hidden bg-[#0B0B0B]">
      <header className="fixed top-0 z-50 flex w-full max-w-md items-center justify-between bg-[#0A0A0A] px-5 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-3">
          <div className="golden-gradient gold-box-glow rounded-full px-4 py-1.5 text-sm font-bold italic tracking-tighter shadow-glow">
            Zenith Ride
          </div>
        </div>

        <div className="flex items-center gap-3">
          {typeof userRating === 'number' && (
            <span className="text-[9px] font-black uppercase tracking-widest text-primary/70">
              * {userRating.toFixed(1)}
            </span>
          )}

          <button
            onClick={onDataSaverToggle}
            title={dataSaver ? 'Modo dados activo' : 'Activar modo dados'}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
              dataSaver ? 'bg-primary/20 text-primary' : 'text-on-surface-variant'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, fontVariationSettings: dataSaver ? "'FILL' 1" : "'FILL' 0" }}
            >
              signal_cellular_alt
            </span>
          </button>

          <button
            onClick={onKazeSilentToggle}
            title={kazeSilent ? 'Kaze silenciado' : 'Kaze activo'}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
              kazeSilent ? 'text-on-surface-variant/40' : 'text-primary'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, fontVariationSettings: kazeSilent ? "'FILL' 0" : "'FILL' 1" }}
            >
              smart_toy
            </span>
          </button>

          <RoleSwitcher compact />
        </div>
      </header>

      <main className="no-scrollbar flex-1 overflow-y-auto pb-24 pt-16">
        {children}
      </main>

      <DevQRCode />

      <nav className="fixed bottom-0 left-1/2 z-50 flex h-20 w-full max-w-md -translate-x-1/2 items-center justify-around border-t border-primary/30 bg-[#000000] px-4">
        {tabs.map((tab) => {
          const active = location.pathname === TAB_ROUTES[tab];
          return (
            <button
              key={tab}
              onClick={() => navigate(TAB_ROUTES[tab])}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-all ${
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
              {active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary animate-pulse" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default Layout;
