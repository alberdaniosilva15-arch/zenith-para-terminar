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

  const isAdmin = role === UserRole.ADMIN;

  const tabs: TabType[] = isAdmin
    ? ['home', 'admin', 'profile']
    : isFleetOwner
    ? ['home', 'profile']
    : isDriver
      ? ['home', 'social', 'rides', 'wallet', 'profile']
      : ['home', 'social', 'precos', 'contrato', 'rides', 'wallet', 'profile'];

  return (
    <div className="zr-shell">
      <div className="zr-app">
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

      <main className="zr-main" style={{ paddingTop: '64px' }}>
        {children}
      </main>

      <DevQRCode />

      <nav className="zr-bottom-nav">
        {tabs.map((tab) => {
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
          return (
            <button
              key={tab}
              onClick={() => navigate(TAB_ROUTES[tab])}
              className={`zr-nav-link ${active ? 'is-active' : ''}`}
            >
              <span className="material-symbols-outlined">
                {TAB_ICONS[tab]}
              </span>
              <span>{labels[tab]}</span>
            </button>
          );
        })}
      </nav>
      </div>
    </div>
  );
};

export default Layout;
