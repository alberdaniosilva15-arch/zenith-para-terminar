import React, { Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRide } from '../hooks/useRide';
import Layout from '../components/Layout';
import FullPageSpinner from '../components/FullPageSpinner';
import Toast from '../components/Toast';
import { TabType, UserRole } from '../types';

const PassengerHome = React.lazy(() => import('../components/PassengerHome'));
const DriverHome = React.lazy(() => import('../components/DriverHome'));
const RidesHistory = React.lazy(() => import('../components/RidesHistory'));
const Wallet = React.lazy(() => import('../components/Wallet'));
const Profile = React.lazy(() => import('../components/Profile'));
const Contract = React.lazy(() => import('../components/Contract'));
const ZonePriceMap = React.lazy(() => import('../components/ZonePriceMap'));
const SocialFeed = React.lazy(() => import('../components/SocialFeed'));
const KazeMascot = React.lazy(() => import('../components/KazeMascot'));
const PostRideReview = React.lazy(() => import('../components/PostRideReview'));
const FleetDashboard = React.lazy(() => import('../components/fleet/FleetDashboard'));

function useMapTabResize() {
  useEffect(() => {
    const dispatchResize = () => {
      window.dispatchEvent(new Event('zenith:map-resize'));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            dispatchResize();
          });
        });
      }
    };

    const handleFocus = () => dispatchResize();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
}

interface TabAwarePanelProps {
  children: React.ReactNode;
  activeTab: TabType;
  thisTab: TabType;
}

function TabAwarePanel({ children, activeTab, thisTab }: TabAwarePanelProps) {
  const isActive = activeTab === thisTab;
  return (
    <div
      style={{
        position: isActive ? 'relative' : 'absolute',
        inset: isActive ? 'auto' : 0,
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
        width: '100%',
        height: '100%',
        zIndex: isActive ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}

function HomePanelFallback({ label }: { label: string }) {
  return (
    <div className="min-h-full flex items-center justify-center rounded-[2rem] bg-[#050912] text-white/60 text-xs font-black uppercase tracking-widest">
      {label}
    </div>
  );
}

export default function AuthenticatedApp() {
  const { dbUser, profile, role, signOut } = useAuth();
  const location = useLocation();

  const {
    ride,
    auction,
    postRide,
    startAuction,
    selectDriver,
    cancelAuction,
    requestRide,
    cancelRide,
    acceptRide,
    confirmRide,
    declineRide,
    advanceStatus,
    submitReview,
    dismissPostRide,
  } = useRide();

  const [dataSaver, setDataSaver] = useState(false);
  const [kazeSilent, setKazeSilent] = useState(false);
  const [hasVisitedHome, setHasVisitedHome] = useState(() => location.pathname === '/');

  useEffect(() => {
    if (location.pathname === '/') {
      setHasVisitedHome(true);
    }
  }, [location.pathname]);

  useMapTabResize();

  let activeTab: TabType = 'home';
  if (location.pathname === '/social') activeTab = 'social';
  else if (location.pathname === '/rides') activeTab = 'rides';
  else if (location.pathname === '/wallet') activeTab = 'wallet';
  else if (location.pathname === '/profile') activeTab = 'profile';
  else if (location.pathname === '/contrato') activeTab = 'contrato';
  else if (location.pathname === '/precos') activeTab = 'precos';

  const effectiveRole = role === UserRole.ADMIN ? UserRole.PASSENGER : role;
  const kazeActive = !kazeSilent;
  const showKaze = kazeActive && effectiveRole !== UserRole.FLEET_OWNER;

  return (
    <Layout
      role={effectiveRole}
      dataSaver={dataSaver}
      onDataSaverToggle={() => setDataSaver((value) => !value)}
      kazeSilent={kazeSilent}
      onKazeSilentToggle={() => setKazeSilent((value) => !value)}
      userName={profile?.name}
      userRating={profile?.rating}
    >
      {hasVisitedHome && (
        <TabAwarePanel activeTab={activeTab} thisTab="home">
          <Suspense
            fallback={
              <HomePanelFallback
                label={
                  effectiveRole === UserRole.PASSENGER
                    ? 'A abrir painel do passageiro...'
                    : effectiveRole === UserRole.FLEET_OWNER
                      ? 'A abrir painel da frota...'
                      : 'A abrir painel do motorista...'
                }
              />
            }
          >
            {effectiveRole === UserRole.PASSENGER ? (
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
                emergencyPhone={profile?.emergency_contact_phone ?? undefined}
                isVisible={activeTab === 'home'}
              />
            ) : effectiveRole === UserRole.FLEET_OWNER ? (
              <FleetDashboard
                ownerId={dbUser?.id ?? ''}
                ownerName={profile?.name}
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
            )}
          </Suspense>
        </TabAwarePanel>
      )}

      <Suspense fallback={<FullPageSpinner label="A carregar página..." />}>
        <Routes>
          <Route path="/" element={null} />
          <Route path="/rides" element={<RidesHistory userId={dbUser?.id ?? ''} />} />
          <Route path="/wallet" element={<Wallet userId={dbUser?.id ?? ''} />} />
          <Route
            path="/profile"
            element={dbUser ? <Profile dbUser={dbUser} profile={profile} onSignOut={signOut} /> : <></>}
          />
          <Route path="/social" element={<SocialFeed userId={dbUser?.id ?? ''} userName={profile?.name ?? ''} role={effectiveRole} />} />
          <Route path="/contrato" element={<Contract />} />
          <Route path="/precos" element={<ZonePriceMap />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      {showKaze && (
        <Suspense fallback={null}>
          <KazeMascot role={effectiveRole} rideStatus={ride.status} dataSaver={dataSaver} userName={profile?.name} />
        </Suspense>
      )}

      {postRide.active && (
        <Suspense fallback={null}>
          <PostRideReview postRide={postRide} onSubmit={submitReview} onDismiss={dismissPostRide} />
        </Suspense>
      )}

      <Toast />
    </Layout>
  );
}
