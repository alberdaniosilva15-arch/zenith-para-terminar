import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAdminAuth } from './hooks/useAdminAuth';
import Sidebar from './components/layout/Sidebar';
import TopBar  from './components/layout/TopBar';
import Login   from './pages/Login';

// Lazy imports — cada módulo carrega só quando necessário (code splitting real)
const Dashboard     = React.lazy(() => import('./pages/Dashboard'));
const PricingPage   = React.lazy(() => import('./pages/Pricing'));
const DriversPage   = React.lazy(() => import('./pages/Drivers'));
const PassengersPage = React.lazy(() => import('./pages/Passengers'));
const RidesPage     = React.lazy(() => import('./pages/Rides'));
const FinancePage   = React.lazy(() => import('./pages/Finance'));
const AdminsPage    = React.lazy(() => import('./pages/Admins'));
const TenantsPage   = React.lazy(() => import('./pages/Tenants'));
const SettingsPage  = React.lazy(() => import('./pages/Settings'));
const ContractsPage = React.lazy(() => import('./pages/Contracts'));

// Fallback de carregamento para lazy loads
const PageLoader: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '12px' }}>
    <span className="spinner" style={{ width: '24px', height: '24px', borderWidth: '2px' }} />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' }}>A carregar módulo...</span>
  </div>
);

// ── Layout protegido ──────────────────────────────────────────────────────────
const ProtectedLayout: React.FC = () => {
  const { isAdmin, isLoading } = useAdminAuth();

  if (isLoading) {
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

  // Validação obrigatória: RPC is_admin verifica role no servidor
  if (!isAdmin) return <Navigate to="/login" replace />;

  return (
    <div className="crm-layout">
      <Sidebar />
      <TopBar />
      <main className="crm-main">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
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
        <Route path="/contracts/*" element={<ContractsPage />} />
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
