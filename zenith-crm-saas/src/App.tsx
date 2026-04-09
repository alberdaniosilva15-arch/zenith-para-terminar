import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAdminAuth } from './hooks/useAdminAuth';
import Sidebar from './components/layout/Sidebar';
import TopBar  from './components/layout/TopBar';
import Login   from './pages/Login';

// Lazy imports — cada módulo carrega só quando necessário
import Dashboard  from './pages/Dashboard';
import PricingPage from './pages/Pricing';
import DriversPage from './pages/Drivers';
import PassengersPage from './pages/Passengers';
import RidesPage  from './pages/Rides';
import FinancePage from './pages/Finance';
import AdminsPage from './pages/Admins';
import TenantsPage from './pages/Tenants';
import SettingsPage from './pages/Settings';

// ── Layout protegido ──────────────────────────────────────────────────────────
const ProtectedLayout: React.FC = () => {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <span className="spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' }}>
          A verificar acesso...
        </span>
      </div>
    );
  }

  if (!admin) return <Navigate to="/login" replace />;

  return (
    <div className="crm-layout">
      <Sidebar />
      <TopBar />
      <main className="crm-main">
        <Outlet />
      </main>
    </div>
  );
};

// ── App Principal ─────────────────────────────────────────────────────────────
const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"  element={<Dashboard />} />
        <Route path="/pricing/*"  element={<PricingPage />} />
        <Route path="/drivers/*"  element={<DriversPage />} />
        <Route path="/passengers/*" element={<PassengersPage />} />
        <Route path="/rides/*"    element={<RidesPage />} />
        <Route path="/finance/*"  element={<FinancePage />} />
        <Route path="/admins/*"   element={<AdminsPage />} />
        <Route path="/tenants/*"  element={<TenantsPage />} />
        <Route path="/settings"   element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </BrowserRouter>
);

export default App;
