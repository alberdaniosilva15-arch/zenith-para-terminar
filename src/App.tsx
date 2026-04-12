// =============================================================================
// ZENITH RIDE v3.1 — App.tsx
// FIXES v3.1:
//   1. Ecrã "a finalizar registo" agora tem botão Sair + timeout de 15s
//   2. Se profile não carregar em 15s, mostra opções de diagnóstico
// =============================================================================

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useRide } from './hooks/useRide';
import Layout from './components/Layout';
import { UserRole, RideStatus, TabType, AutonomousCommand } from './types';
import PassengerHome from './components/PassengerHome';
import DriverHome from './components/DriverHome';
import RidesHistory from './components/RidesHistory';
import Wallet from './components/Wallet';
import Profile from './components/Profile';
import KazeMascot from './components/KazeMascot';
import Contract from './components/Contract';
import Login from './components/Login';
const SocialFeed = React.lazy(() => import('./components/SocialFeed'));
import PostRideReview from './components/PostRideReview';
import ZonePriceMap from './components/ZonePriceMap';
import ParentTrackingPage from './components/ParentTrackingPage';
import { geminiService } from './services/geminiService';
import Toast from './components/Toast';
import { MapSingleton } from "./lib/mapInstance";

// ─── TAB RESIZE HOOK ─────────────────────────────────────────
function useMapTabResize() {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            MapSingleton.resize();
          });
        });
      }
    };
    const handleFocus = () => MapSingleton.resize();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}

// ─── TAB AWARE PANEL ─────────────────────────────────────────
interface TabAwarePanelProps {
  children: React.ReactNode;
  activeTab: string;
  thisTab:   string;
}
function TabAwarePanel({ children, activeTab, thisTab }: TabAwarePanelProps) {
  const isActive = activeTab === thisTab;
  return (
    <div style={{
      position:       isActive ? "relative" : "absolute",
      inset:          isActive ? "auto" : 0,
      visibility:     isActive ? "visible" : "hidden",
      pointerEvents:  isActive ? "auto"    : "none",
      width:          "100%",
      height:         "100%",
      zIndex:         isActive ? 1 : 0,
    }}>
      {children}
    </div>
  );
}

// =============================================================================
// LAZY COMPONENTS (FASE 2)
// =============================================================================
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));

// =============================================================================
// PREPARATION ROUTE (FASE 2)
// =============================================================================
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { dbUser, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6">
      <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-white/60 text-xs font-black uppercase tracking-widest">Zenith Ride</p>
    </div>
  );
  if (!dbUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

// =============================================================================
// =============================================================================
// ECRÃ DE REGISTO PRESO — FIX v3.1
// Mostrado quando há sessão mas o perfil ainda não carregou
// Tem timeout de 15s, botão Sair e diagnóstico
// =============================================================================
const StuckRegistrationScreen: React.FC<{ onSignOut: () => void }> = ({ onSignOut }) => {
  const [seconds, setSeconds] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(prev => {
        if (prev >= 14) { setTimedOut(true); clearInterval(interval); }
        return prev + 1;
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
            <p className="text-white/80 font-bold">Conta autenticada — a finalizar registo...</p>
            <p className="text-white/40 text-xs mt-2">({15 - seconds}s)</p>
          </div>
          <p className="text-white/40 text-sm max-w-sm text-center">
            Estamos a concluir a criação do teu perfil. Aguarda um momento.
          </p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
            <span className="text-3xl">⚠️</span>
          </div>
          <div className="text-center space-y-2">
            <p className="text-white font-black">Não foi possível finalizar o registo</p>
            <p className="text-white/50 text-sm max-w-sm text-center">
              O trigger <code className="text-primary bg-primary/10 px-1 rounded">handle_new_user</code> no Supabase pode não estar activo, ou as tabelas <code className="text-primary bg-primary/10 px-1 rounded">users</code> / <code className="text-primary bg-primary/10 px-1 rounded">profiles</code> não existem.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-primary/90 transition-all"
            >
              🔄 Tentar de Novo
            </button>
            <button
              onClick={onSignOut}
              className="w-full py-4 bg-white/5 text-white/70 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all border border-white/10"
            >
              ← Sair e Voltar ao Login
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// =============================================================================
// APP INTERNO (dentro do AuthProvider)
// =============================================================================
const AppInner: React.FC = () => {
  const { dbUser, profile, role, loading: authLoading, session, signOut } = useAuth();

  const {
    ride, auction, postRide, loading,
    startAuction, selectDriver, cancelAuction,
    requestRide, cancelRide,
    acceptRide, confirmRide, declineRide, advanceStatus,
    submitReview, dismissPostRide,
  } = useRide();

  const [dataSaver,   setDataSaver]   = useState(false);
  const [kazeSilent,  setKazeSilent]  = useState(false);
  const [lastCommand, setLastCommand] = useState<AutonomousCommand | null>(null);
  const [activeTab,   setActiveTab]   = useState('home');

  useMapTabResize();

  // Vigilante Engine — só para admins, a cada 2 minutos
  useEffect(() => {
    if (role !== UserRole.ADMIN || !dbUser) return;

    const runVigilante = async () => {
      const commands = await geminiService.getAutonomousDecisions({
        role:             role,
        activeRideStatus: ride.status,
        multiplier:       ride.surgeMultiplier,
      });
      if (commands.length > 0) setLastCommand(commands[0]);
    };

    runVigilante();
  }, [role, dbUser, ride.status]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-white/60 text-xs font-black uppercase tracking-widest">Zenith Ride</p>
      </div>
    );
  }

  const kazeActive = !kazeSilent;
  const location = useLocation();

  return (
    <Routes>
      <Route 
        path="/login" 
        element={
          dbUser ? <Navigate to="/" replace /> : (
            session ? (
              <StuckRegistrationScreen onSignOut={signOut} />
            ) : <Login />
          )
        } 
      />
      
      <Route path="*" element={
        <ProtectedRoute>
          <Layout
            role={role}
            dataSaver={dataSaver}
            onDataSaverToggle={() => setDataSaver(v => !v)}
            kazeSilent={kazeSilent}
            onKazeSilentToggle={() => setKazeSilent(v => !v)}
            userName={profile?.name}
            userRating={profile?.rating}
          >
            {role === UserRole.PASSENGER && (
              <TabAwarePanel activeTab={activeTab} thisTab="home">
                <PassengerHome
                  ride={ride}
                  auction={auction}
                  userId={dbUser?.id ?? ''}
                  onStartAuction={startAuction}
                  onSelectDriver={selectDriver}
                  onCancelAuction={cancelAuction}
                  onRequestRide={requestRide}
                  onCancelRide={cancelRide}
                  dataSaver={dataSaver}
                />
              </TabAwarePanel>
            )}

            <Routes>
              {role === UserRole.ADMIN ? (
                <Route path="*" element={
                  <Suspense fallback={<div className="flex items-center justify-center p-8 text-white"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
                    <AdminDashboard lastCommand={lastCommand} />
                  </Suspense>
                } />
              ) : (
                <>
                  <Route path="/" element={
                    role === UserRole.PASSENGER ? null : (
                      <DriverHome
                        ride={ride}
                        onAcceptRide={acceptRide}
                        onConfirmRide={confirmRide}
                        onDeclineRide={declineRide}
                        onAdvanceStatus={advanceStatus}
                        driverId={dbUser?.id ?? ''}
                      />
                    )
                  } />
                  <Route path="/rides" element={<RidesHistory userId={dbUser?.id ?? ''} />} />
                  <Route path="/wallet" element={<Wallet userId={dbUser?.id ?? ''} />} />
                  <Route path="/profile" element={dbUser ? <Profile dbUser={dbUser} profile={profile} onSignOut={signOut} /> : <></>} />
                  <Route path="/social" element={<Suspense fallback={<div className="flex justify-center p-4 text-white/50"><span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}><SocialFeed userId={dbUser?.id ?? ''} userName={profile?.name ?? ''} role={role} /></Suspense>} />
                  <Route path="/contrato" element={<Contract />} />
                  <Route path="/precos" element={<ZonePriceMap />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>

            {kazeActive && (
              <KazeMascot
                role={role}
                rideStatus={ride.status}
                dataSaver={dataSaver}
                userName={profile?.name}
              />
            )}

            <PostRideReview
              postRide={postRide}
              onSubmit={submitReview}
              onDismiss={dismissPostRide}
            />

            <Toast />
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  );
};

// =============================================================================
// APP ROOT
// =============================================================================
const App: React.FC = () => {
  // v3.0: rota pública /track/:token — sem AuthProvider
  const pathMatch = window.location.pathname.match(/^\/track\/([0-9a-f-]{36})$/);
  if (pathMatch) {
    return <ParentTrackingPage token={pathMatch[1]} />;
  }

  // Envolver com BrowserRouter de forma segura para migração progressiva
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
