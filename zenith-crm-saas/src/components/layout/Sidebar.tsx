import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import {
  LayoutDashboard, DollarSign, Users, UserCheck,
  Map, TrendingUp, Building2, Settings, LogOut, ShieldCheck, FileText, Bot
} from 'lucide-react';

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/kaze',        icon: Bot,             label: 'KAZE AGENTE' },
  { to: '/pricing',     icon: DollarSign,      label: 'Pricing Engine' },
  { to: '/drivers',     icon: UserCheck,       label: 'Motoristas' },
  { to: '/passengers',  icon: Users,           label: 'Passageiros' },
  { to: '/contracts',   icon: FileText,        label: 'Contratos IA' },
  { to: '/rides',       icon: Map,             label: 'Corridas' },
  { to: '/finance',     icon: TrendingUp,      label: 'Financeiro' },
  { to: '/admins',      icon: ShieldCheck,     label: 'Equipa Admin' },
  { to: '/tenants',     icon: Building2,       label: 'Tenants' },
  { to: '/settings',    icon: Settings,        label: 'Configurações' },
];

const Sidebar: React.FC = () => {
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <aside className="crm-sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-title">⚡ ZENITH</div>
        <div className="sidebar-logo-sub">CRM Engine</div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Principal</div>

        {NAV.slice(0, 3).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}${to === '/kaze' ? ' !border-[#d4af37]/20 !shadow-[0_0_10px_rgba(212,175,55,0.05)]' : ''}`}
            style={to === '/kaze' ? { background: 'linear-gradient(90deg, rgba(212,175,55,0.05) 0%, transparent 100%)' } : {}}
          >
            <Icon className="icon" style={to === '/kaze' ? { color: '#d4af37' } : {}} />
            {to === '/kaze' ? (
              <span className="flex-1 font-bold text-[#d4af37] tracking-wider" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {label}
                <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(212,175,55,0.2)', border: '1px solid rgba(212,175,55,0.3)' }}>AI</span>
              </span>
            ) : (
              label
            )}
          </NavLink>
        ))}

        <div className="sidebar-section-label" style={{ marginTop: '8px' }}>Gestão</div>

        {NAV.slice(3, 9).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <Icon className="icon" />
            {label}
          </NavLink>
        ))}

        <div className="sidebar-section-label" style={{ marginTop: '8px' }}>Sistema</div>

        {NAV.slice(9).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <Icon className="icon" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-avatar">
          {(user?.email ?? 'A').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email?.split('@')[0] ?? 'Admin'}
          </div>
          <div className="sidebar-user-role">Administrador</div>
        </div>
        <button
          onClick={handleSignOut}
          title="Sair"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: '4px' }}
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
