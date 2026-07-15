import React, { Suspense } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Bot, LayoutDashboard, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import FullPageSpinner from '../components/FullPageSpinner';
import { UserRole } from '../types';
import AdminLogin from './AdminLogin';



const AdminDashboard = React.lazy(() => import('../components/AdminDashboard'));

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { dbUser, loading, role } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullPageSpinner label="A abrir CRM admin..." />;
  }

  if (!dbUser) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (role !== UserRole.ADMIN) {
    return <AdminAccessDenied />;
  }

  return <>{children}</>;
}

function AdminAccessDenied() {
  const { signOut, authUser } = useAuth();

  return (
    <div style={centerShellStyle}>
      <div style={cardStyle}>
        <p style={kickerStyle}>Acesso restrito</p>
        <h1 style={{ margin: '10px 0 0', fontSize: 28, fontWeight: 800 }}>Esta conta não é admin</h1>
        <p style={copyStyle}>
          O CRM administrativo só abre com uma conta `admin`. A conta activa agora é {authUser?.email ?? 'desconhecida'}.
        </p>
        <button onClick={() => void signOut()} style={buttonStyle}>
          Trocar de conta
        </button>
      </div>
    </div>
  );
}

function AdminShell() {
  const { signOut } = useAuth();

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div>
          <p style={kickerStyle}>Zenith Ride</p>
          <h1 style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 800, color: '#f1fffd' }}>CRM Admin Core</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NavLink to="/admin/kaze" style={navLinkStyle}>
            <Bot size={16} />
            <span>Kaze Core</span>
          </NavLink>
          <NavLink to="/admin/dashboard" style={navLinkStyle}>
            <LayoutDashboard size={16} />
            <span>Operações</span>
          </NavLink>
          <button onClick={() => void signOut()} style={logoutButtonStyle}>
            <LogOut size={16} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0, padding: 18 }}>
        <div style={contentFrameStyle}>
          <Suspense fallback={<FullPageSpinner label="A abrir cockpit admin..." />}>
            <Routes>
              <Route path="/" element={<Navigate to="/admin/kaze" replace />} />
              <Route path="/admin" element={<Navigate to="/admin/kaze" replace />} />
              <Route path="*" element={<Navigate to="/admin/kaze" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function AdminRouter() {
  return (
    <Suspense fallback={<FullPageSpinner label="A abrir cockpit admin..." />}>
      <Routes>
        {/* Kaze Core is now integrated into the AdminDashboard */}
        <Route path="/admin/kaze" element={<Navigate to="/admin/dashboard" replace />} />
        {/* Dashboard has its own full layout (AdminLayout), renders at full viewport */}
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        {/* Everything else uses the AdminShell chrome */}
        <Route path="/*" element={<AdminShell />} />
      </Routes>
    </Suspense>
  );
}

function AdminRoutes() {
  const { dbUser, loading, role } = useAuth();

  if (loading) {
    return <FullPageSpinner label="A iniciar CRM admin..." />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={dbUser && role === UserRole.ADMIN ? <Navigate to="/admin/kaze" replace /> : <AdminLogin />}
      />
      <Route
        path="/*"
        element={
          <ProtectedAdminRoute>
            <AdminRouter />
          </ProtectedAdminRoute>
        }
      />
    </Routes>
  );
}

export default function AdminApp() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AdminRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

const centerShellStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background:
    'radial-gradient(circle at 50% 20%, rgba(43,255,226,0.14), transparent 22%), linear-gradient(160deg, #02060d 0%, #06111a 45%, #03070d 100%)',
  color: '#edfffb',
} satisfies React.CSSProperties;

const cardStyle = {
  width: 'min(100%, 520px)',
  borderRadius: 28,
  border: '1px solid rgba(87,255,222,0.14)',
  background: 'rgba(5, 15, 24, 0.9)',
  boxShadow: '0 30px 80px rgba(0,0,0,0.4), inset 0 0 60px rgba(0,194,255,0.06)',
  padding: 28,
} satisfies React.CSSProperties;

const shellStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background:
    'radial-gradient(circle at 50% 15%, rgba(43,255,226,0.12), transparent 20%), linear-gradient(160deg, #02060d 0%, #06111a 45%, #03070d 100%)',
} satisfies React.CSSProperties;

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '18px 22px',
  borderBottom: '1px solid rgba(87,255,222,0.1)',
  background: 'rgba(3, 10, 17, 0.92)',
  backdropFilter: 'blur(14px)',
} satisfies React.CSSProperties;

const contentFrameStyle = {
  height: 'calc(100vh - 108px)',
  borderRadius: 24,
  overflow: 'auto',
  border: '1px solid rgba(87,255,222,0.12)',
  boxShadow: 'inset 0 0 60px rgba(0,194,255,0.04)',
  background: 'rgba(3, 12, 19, 0.78)',
} satisfies React.CSSProperties;

const kickerStyle = {
  margin: 0,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.22em',
  color: '#8cefe3',
} satisfies React.CSSProperties;

const copyStyle = {
  marginTop: 14,
  color: 'rgba(212,255,248,0.72)',
  lineHeight: 1.6,
} satisfies React.CSSProperties;

const buttonStyle = {
  marginTop: 20,
  borderRadius: 18,
  border: '1px solid rgba(87,255,222,0.18)',
  background: 'linear-gradient(145deg, rgba(24,169,255,0.28), rgba(76,245,216,0.24))',
  color: '#f0fffd',
  padding: '14px 18px',
  fontWeight: 700,
  cursor: 'pointer',
} satisfies React.CSSProperties;

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 16,
  border: `1px solid ${isActive ? 'rgba(87,255,222,0.36)' : 'rgba(87,255,222,0.12)'}`,
  background: isActive ? 'rgba(13, 39, 50, 0.9)' : 'rgba(5, 15, 24, 0.8)',
  color: '#edfffb',
  textDecoration: 'none',
  fontWeight: 700,
}) satisfies React.CSSProperties;

const logoutButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#edfffb',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies React.CSSProperties;
