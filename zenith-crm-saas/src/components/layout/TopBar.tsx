import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, Bell } from 'lucide-react';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':  'Dashboard Central',
  '/pricing':    'Pricing Engine',
  '/drivers':    'Gestão de Motoristas',
  '/passengers': 'Gestão de Passageiros',
  '/rides':      'Corridas',
  '/finance':    'Painel Financeiro',
  '/tenants':    'White-Label / Tenants',
  '/settings':   'Configurações',
};

const TopBar: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => {
  const location = useLocation();
  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? 'Zenith CRM';

  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('pt-AO', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Africa/Luanda',
      }));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="crm-topbar">
      <h1 className="topbar-title">{title}</h1>

      <div className="topbar-live">
        <span className="topbar-live-dot" />
        REALTIME
      </div>

      <span className="topbar-time">{time} AOT</span>

      {onRefresh && (
        <button
          onClick={onRefresh}
          className="btn btn-ghost btn-sm"
          title="Actualizar dados"
        >
          <RefreshCw size={13} />
        </button>
      )}

      <button className="btn btn-ghost btn-sm" title="Notificações">
        <Bell size={13} />
      </button>
    </header>
  );
};

export default TopBar;
