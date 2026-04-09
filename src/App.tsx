// =============================================================================
// ZENITH RIDE v3.0 — App.tsx
// Actualizado para suportar:
// - Leilão de motoristas (auction flow)
// - PostRideReview (avaliação pós-corrida)
// - DriverHome com confirmRide/declineRide
// - PassengerHome com startAuction/selectDriver/cancelAuction
// - IA condicional: Kaze silencioso quando ride.status === IDLE
// =============================================================================

import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

  return (
    <Routes>
      <Route 
        path="/login" 
        element={
          dbUser ? <Navigate to="/" replace /> : (
            session ? (
              <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6 p-6">
                <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-white/80 font-bold">Conta autenticada — a finalizar registo...</p>
                <p className="text-white/50 text-sm max-w-lg text-center mt-2">Estamos a concluir a criação do teu perfil. Se isto não avançar em alguns segundos, confirma que o teu projeto Supabase tem o trigger <code>handle_new_user</code> e as tabelas do schema.</p>
              </div>
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
                    role === UserRole.PASSENGER ? (
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
                    ) : (
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
