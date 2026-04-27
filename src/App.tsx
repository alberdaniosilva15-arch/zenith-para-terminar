import React, { Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import FullPageSpinner from './components/FullPageSpinner';

const Login = React.lazy(() => import('./components/Login'));
const ParentTrackingPage = React.lazy(() => import('./components/ParentTrackingPage'));
const AuthenticatedApp = React.lazy(() => import('./app/AuthenticatedApp'));

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { dbUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-white/60 text-xs font-black uppercase tracking-widest">Zenith Ride</p>
      </div>
    );
  }

  if (!dbUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const StuckRegistrationScreen: React.FC<{ onSignOut: () => void }> = ({ onSignOut }) => {
  const [seconds, setSeconds] = React.useState(0);
  const [timedOut, setTimedOut] = React.useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((previous) => {
        if (previous >= 14) {
          setTimedOut(true);
          clearInterval(interval);
        }
        return previous + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6 p-6">
      {!timedOut ? (
        <>
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-white/80 font-bold">Conta autenticada - a finalizar registo...</p>
            <p className="text-white/40 text-xs mt-2">({15 - seconds}s)</p>
          </div>
          <p className="text-white/40 text-sm max-w-sm text-center">
            Estamos a concluir a criacao do teu perfil. Aguarda um momento.
          </p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <div className="text-center space-y-2">
            <p className="text-white font-black">Nao foi possivel finalizar o registo</p>
            <p className="text-white/50 text-sm max-w-sm text-center">
              O trigger <code className="text-primary bg-primary/10 px-1 rounded">handle_new_user</code> no Supabase pode nao estar activo, ou as tabelas <code className="text-primary bg-primary/10 px-1 rounded">users</code> / <code className="text-primary bg-primary/10 px-1 rounded">profiles</code> nao existem.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-primary/90 transition-all"
            >
              Tentar de Novo
            </button>
            <button
              onClick={onSignOut}
              className="w-full py-4 bg-white/5 text-white/70 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all border border-white/10"
            >
              Voltar ao Login
            </button>
          </div>
        </>
      )}
    </div>
  );
};

function SessionResetScreen({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void onSignOut();
  }, [onSignOut]);

  return <FullPageSpinner label="A limpar a sessao antiga..." />;
}

function AuthShellRoutes() {
  const { dbUser, loading, session, signOut } = useAuth();
  const location = useLocation();

  const isRecoveryRoute = hasRecoveryType(location.search, location.hash);
  const isSessionResetRoute = hasSessionResetRequest(location.pathname, location.search);

  if (isSessionResetRoute && !isRecoveryRoute) {
    return <SessionResetScreen onSignOut={signOut} />;
  }

  if (loading) {
    return <FullPageSpinner label="A iniciar Zenith Ride..." />;
  }

  const loginScreen = (
    <Suspense fallback={<FullPageSpinner label="A abrir login..." />}>
      <Login />
    </Suspense>
  );

  return (
    <Routes>
      <Route
        path="/login"
        element={
          dbUser && !isRecoveryRoute ? <Navigate to="/" replace /> : (
            session ? (isRecoveryRoute ? loginScreen : <StuckRegistrationScreen onSignOut={signOut} />) : loginScreen
          )
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Suspense fallback={<FullPageSpinner label="A abrir a tua conta..." />}>
              <AuthenticatedApp />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function AuthenticatedRoutesRoot() {
  return (
    <AuthProvider>
      <AuthShellRoutes />
    </AuthProvider>
  );
}

const trackingScreen = (
  <Suspense fallback={<FullPageSpinner label="A carregar rastreamento..." />}>
    <ParentTrackingPage />
  </Suspense>
);

const App: React.FC = () => {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/track/:token" element={trackingScreen} />
        <Route path="/tracking/:token" element={trackingScreen} />
        <Route path="/*" element={<AuthenticatedRoutesRoot />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;

function hasRecoveryType(search: string, hash: string): boolean {
  const searchParams = new URLSearchParams(search);
  if (searchParams.get('type') === 'recovery') return true;

  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!normalizedHash) return false;

  const hashParams = new URLSearchParams(normalizedHash);
  return hashParams.get('type') === 'recovery';
}

function hasSessionResetRequest(pathname: string, search: string): boolean {
  if (pathname === '/logout' || pathname === '/switch-account') return true;
  const searchParams = new URLSearchParams(search);
  return searchParams.get('logout') === '1' || searchParams.get('switch') === '1';
}
