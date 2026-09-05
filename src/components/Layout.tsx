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
  admin: 'admin_panel_settings',
};

const TAB_ROUTES: Record<TabType, string> = {
  home: '/',
  social: '/social',
  contrato: '/contrato',
  rides: '/rides',
  wallet: '/wallet',
  profile: '/profile',
  precos: '/precos',
  admin: '/admin',
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
      : ['home', 'social', 'precos', 'rides', 'wallet', 'profile'];

  return (
    <div className="zr-shell">
      <div className="zr-app">
      <header className="fixed top-0 z-50 flex w-full max-w-md items-center justify-between bg-[#040406]/92 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center space-x-2.5">
          {/* Hexagonal Z Shield Liquid Glass Bubble */}
          <div className="w-9 h-9 rounded-xl liquid-glass-subcard border-t-[rgba(255,245,210,0.5)] border-[#DDB658]/40 flex items-center justify-center p-0.5 shadow-md shadow-black/80">
            <svg className="w-5 h-5 text-[#F0D082] filter drop-shadow-[0_2px_4px_rgba(220,175,60,0.45)]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
              <polygon points="12 2 21.5 7.5 21.5 16.5 12 22 2.5 16.5 2.5 7.5 12 2"></polygon>
              <path d="M8 8.5h8l-8 7h8" strokeWidth="2.4"></path>
            </svg>
          </div>
          <div>
            <h1 className="font-serif text-[17px] tracking-wide text-white font-semibold leading-tight">Zenith Ride</h1>
            <p className="font-sans text-[8px] uppercase tracking-[0.24em] font-bold gold-gradient-text">PREMIUM MOBILITY</p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Rating Pill (Glass Bubble) */}
          <div className="liquid-glass-subcard flex flex-col items-center justify-center px-2 py-0.5 rounded-full border-t-white/30">
            <div className="flex items-center space-x-1 text-[10.5px] font-bold text-white">
              <span className="text-[#E8C268] text-[10px] filter drop-shadow-[0_0_4px_rgba(232,194,104,0.6)]">★</span>
              <span>{typeof userRating === 'number' ? userRating.toFixed(1) : '5.0'}</span>
            </div>
            <span className="text-[6.5px] tracking-widest uppercase text-neutral-400 font-semibold">AVALIAÇÃO</span>
          </div>

          <button
            onClick={onDataSaverToggle}
            title={dataSaver ? 'Modo dados activo' : 'Activar modo dados'}
            className={`w-8 h-8 rounded-full liquid-glass-subcard flex items-center justify-center transition-all ${
              dataSaver ? 'border-[#DDB658]/60 text-primary' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15, fontVariationSettings: dataSaver ? "'FILL' 1" : "'FILL' 0" }}
            >
              signal_cellular_alt
            </span>
          </button>

          <button
            onClick={onKazeSilentToggle}
            title={kazeSilent ? 'Kaze silenciado' : 'Kaze activo'}
            className={`w-8 h-8 rounded-full liquid-glass-subcard flex items-center justify-center transition-all ${
              kazeSilent ? 'text-neutral-500' : 'text-primary'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15, fontVariationSettings: kazeSilent ? "'FILL' 0" : "'FILL' 1" }}
            >
              smart_toy
            </span>
          </button>

          <RoleSwitcher compact />
        </div>
      </header>

      <main className="zr-main" style={{ paddingTop: '64px' }}>
        {children}
      </main>

      <DevQRCode />

      <nav className="zr-bottom-nav">
        {tabs.map((tab, idx) => {
          const active = location.pathname === TAB_ROUTES[tab];
          const labels: Record<TabType, string> = {
            home: 'Home',
            social: 'Social',
            contrato: 'Contratos',
            rides: 'Histórico',
            wallet: 'Carteira',
            profile: 'Perfil',
            precos: 'Preços',
            admin: 'Admin',
          };
          const isCenter = !isFleetOwner && idx === 3;
          return (
            <React.Fragment key={tab}>
              {isCenter && <div style={{ width: '56px', flexShrink: 0 }} aria-hidden="true" />}
              <button
                onClick={() => navigate(TAB_ROUTES[tab])}
                className={`zr-nav-link ${active ? 'is-active' : ''}`}
                aria-label={labels[tab]}
                title={labels[tab]}
              >
                <span className="material-symbols-outlined">
                  {TAB_ICONS[tab]}
                </span>
                <span className="zr-nav-label">{labels[tab]}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>
      </div>
    </div>
  );
};

export default Layout;
