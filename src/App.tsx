// =============================================================================
// MOTOGO AI v2.1 — App.tsx
// Actualizado para suportar:
// - Leilão de motoristas (auction flow)
// - PostRideReview (avaliação pós-corrida)
// - DriverHome com confirmRide/declineRide
// - PassengerHome com startAuction/selectDriver/cancelAuction
// - IA condicional: Kaze silencioso quando ride.status === IDLE
// =============================================================================

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useRide } from './hooks/useRide';
import Layout from './components/Layout';
import { UserRole, RideStatus, TabType, AutonomousCommand } from './types';
import PassengerHome from './components/PassengerHome';
import DriverHome from './components/DriverHome';
import AdminDashboard from './components/AdminDashboard';
import RidesHistory from './components/RidesHistory';
import Wallet from './components/Wallet';
import Profile from './components/Profile';
import KazeMascot from './components/KazeMascot';
import Contract from './components/Contract';
import Login from './components/Login';
import SocialFeed from './components/SocialFeed';
import PostRideReview from './components/PostRideReview';
import ZonePriceMap from './components/ZonePriceMap';
import ParentTrackingPage from './components/ParentTrackingPage';
import { geminiService } from './services/geminiService';
import Toast from './components/Toast';

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

  const [activeTab,   setActiveTab]   = useState<TabType>('home');
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
    const timer = setInterval(runVigilante, 120_000);
    return () => clearInterval(timer);
  }, [role, dbUser, ride.status]);

  // ------------------------------------------------------------------
  // Loading screen
  // ------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-white/60 text-xs font-black uppercase tracking-widest">Zenith Ride</p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Login / awaiting setup screen
  // If we have a valid session but the DB user row hasn't been created
  // yet (trigger latency), show a finalizing message instead of the
  // login form so the user sees progress after clicking the magic link.
  // ------------------------------------------------------------------
  if (!dbUser) {
    if (session) {
      return (
        <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6 p-6">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-white/80 font-bold">Conta autenticada — a finalizar registo...</p>
          <p className="text-white/50 text-sm max-w-lg text-center mt-2">Estamos a concluir a criação do teu perfil. Se isto não avançar em alguns segundos, confirma que o teu projeto Supabase tem o trigger <code>handle_new_user</code> e as tabelas do schema.</p>
        </div>
      );
    }

    return <Login />;
  }

  // ------------------------------------------------------------------
  // App principal
  // ------------------------------------------------------------------
  const renderContent = () => {
    if (role === UserRole.ADMIN) {
      return <AdminDashboard lastCommand={lastCommand} />;
    }

    switch (activeTab) {
      case 'home':
        if (role === UserRole.PASSENGER) {
          return (
            <PassengerHome
              ride={ride}
              auction={auction}
              userId={dbUser.id}
              onStartAuction={startAuction}
              onSelectDriver={selectDriver}
              onCancelAuction={cancelAuction}
              onRequestRide={requestRide}
              onCancelRide={cancelRide}
              dataSaver={dataSaver}
            />
          );
        }
        return (
          <DriverHome
            ride={ride}
            onAcceptRide={acceptRide}
            onConfirmRide={confirmRide}
            onDeclineRide={declineRide}
            onAdvanceStatus={advanceStatus}
            driverId={dbUser.id}
          />
        );

      case 'rides':
        return <RidesHistory userId={dbUser.id} />;

      case 'wallet':
        return <Wallet userId={dbUser.id} />;

      case 'profile':
        return <Profile dbUser={dbUser} profile={profile} onSignOut={signOut} />;

      case 'social':
        return <SocialFeed userId={dbUser.id} userName={profile?.name ?? ''} role={role} />;

      case 'contrato':
        return <Contract />;

      case 'precos':
        return <ZonePriceMap />;

      default:
        return null;
    }
  };

  // Kaze sempre disponível (chat + explore), pensamentos espontâneos só durante corridas
  const kazeActive = !kazeSilent;

  return (
    <Layout
      role={role}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dataSaver={dataSaver}
      onDataSaverToggle={() => setDataSaver(v => !v)}
      kazeSilent={kazeSilent}
      onKazeSilentToggle={() => setKazeSilent(v => !v)}
      userName={profile?.name}
      userRating={profile?.rating}
    >
      {renderContent()}

      {/* Kaze — sempre disponível para chat e assistência */}
      {kazeActive && (
        <KazeMascot
          role={role}
          rideStatus={ride.status}
          dataSaver={dataSaver}
          userName={profile?.name}
        />
      )}

      {/* PostRideReview — aparece automaticamente após corrida concluída */}
      <PostRideReview
        postRide={postRide}
        onSubmit={submitReview}
        onDismiss={dismissPostRide}
      />

      {/* Toast — notificações globais de sistema */}
      <Toast />
    </Layout>
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

  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
};

export default App;
