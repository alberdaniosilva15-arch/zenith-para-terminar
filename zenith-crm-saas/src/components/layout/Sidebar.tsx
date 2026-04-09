import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import {
  LayoutDashboard, DollarSign, Users, UserCheck,
  Map, TrendingUp, Building2, Settings, LogOut, ShieldCheck
} from 'lucide-react';

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/pricing',     icon: DollarSign,      label: 'Pricing Engine' },
  { to: '/drivers',     icon: UserCheck,       label: 'Motoristas' },
  { to: '/passengers',  icon: Users,           label: 'Passageiros' },
  { to: '/rides',       icon: Map,             label: 'Corridas' },
  { to: '/finance',     icon: TrendingUp,      label: 'Financeiro' },
  { to: '/admins',      icon: ShieldCheck,     label: 'Equipa Admin' },
  { to: '/tenants',     icon: Building2,       label: 'Tenants' },
  { to: '/settings',    icon: Settings,        label: 'Configurações' },
];

const Sidebar: React.FC = () => {
  const { admin, signOut } = useAdminAuth();
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

        {NAV.slice(0, 2).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <Icon className="icon" />
            {label}
          </NavLink>
        ))}

        <div className="sidebar-section-label" style={{ marginTop: '8px' }}>Gestão</div>

        {NAV.slice(2, 7).map(({ to, icon: Icon, label }) => (
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

        {NAV.slice(7).map(({ to, icon: Icon, label }) => (
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
          {(admin?.name ?? 'A').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {admin?.name ?? 'Admin'}
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
