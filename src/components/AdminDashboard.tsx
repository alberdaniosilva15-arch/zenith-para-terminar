import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import FullPageSpinner from './FullPageSpinner';
import { UserRole, AutonomousCommand } from '../types';

import { AdminLayout } from './admin/AdminLayout';

import { LiveMapTab } from './admin/tabs/LiveMapTab';
import { MarketFinanceTab } from './admin/tabs/MarketFinanceTab';
import { ZonePricingTab } from './admin/tabs/ZonePricingTab';
import { UsersTab } from './admin/tabs/UsersTab';
import { SettingsTab } from './admin/tabs/SettingsTab';
import KazePanel from './KazePanel';

import AdminSOSPanel from './admin/AdminSOSPanel';
import { AdminDriverDocs } from './AdminDriverDocs';
import AdminServicesPanel from './admin/AdminServicesPanel';

interface AdminDashboardProps {
  lastCommand?: AutonomousCommand | null;
}

const AdminDashboardInner: React.FC<AdminDashboardProps> = () => {
  const [activeTab, setActiveTab] = useState('kaze');

  const renderTab = () => {
    switch (activeTab) {
      case 'kaze': return <KazePanel />;
      case 'map': return <LiveMapTab />;
      case 'market': return <MarketFinanceTab />;
      case 'pricing': return <ZonePricingTab />;
      case 'services': return <AdminServicesPanel />;
      case 'security': return <AdminSOSPanel />;
      case 'users': return <UsersTab />;
      case 'drivers': return <AdminDriverDocs />;
      case 'settings': return <SettingsTab />;
      default: return <LiveMapTab />;
    }
  };

  return (
    <AdminLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderTab()}
    </AdminLayout>
  );
};

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  const { loading, role } = useAuth();

  if (loading) {
    return <FullPageSpinner label="A validar acesso de admin..." />;
  }

  if (role !== UserRole.ADMIN) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 bg-background">
        <div className="max-w-md rounded-xl border border-error bg-surface-container-low p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-error">Acesso restrito</p>
          <h2 className="mt-3 text-2xl font-black text-on-surface">Painel apenas para administradores</h2>
          <p className="mt-3 text-sm font-bold text-on-surface-variant/70">
            Esta área exige uma conta com role <code>admin</code>.
          </p>
        </div>
      </div>
    );
  }

  return <AdminDashboardInner {...props} />;
};

export default AdminDashboard;
