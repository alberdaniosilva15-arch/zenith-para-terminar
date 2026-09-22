import React, { Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRide } from '../hooks/useRide';
import Layout from '../components/Layout';
import FullPageSpinner from '../components/FullPageSpinner';
import Toast from '../components/Toast';
import ErrorBoundary from '../components/ErrorBoundary';
import ScreamGuard from '../components/ScreamGuard';
import { TabType, UserRole, RideStatus } from '../types';

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

// ── Frota: porque é que isto voltou a ficar ligado (2026-09-22) ──────────────
//
// Estava `false`, com um comentário a mandar ler um ficheiro —
// `ZENITH_RIDE_DECISOES_FINAIS_P0_P1.txt` — que NÃO EXISTE no repositório.
//
// O efeito era pior do que "frota desligada": o ternário de render caía no
// ramo final, que é o `DriverHome`. Ou seja, um dono de frota que escolhia
// "Modo Frota" era atirado para o ECRÃ DE MOTORISTA. É a razão pela qual
// contas de frota apareciam como motorista.
//
// O painel está escrito e é coerente (424 linhas, lê `fleets`, `fleet_cars`,
// `fleet_driver_agreements`, `fleet_subscriptions`). O que faltava não era
// código: era o papel de frota deixar de ser atribuível por qualquer um (ver a
// migração 20260922120000_seguranca_papeis_e_documentos.sql). Agora só entra
// aqui quem tem mesmo uma frota.
const FLEET_DASHBOARD_ENABLED = true;

/**
 * Rede de segurança do modo frota.
 *
 * Se algum dia alguém voltar a pôr `FLEET_DASHBOARD_ENABLED` a `false`, um dono
 * de frota passa a ver ESTE aviso — e não o ecrã de motorista. Um painel por
 * acabar é um problema; um painel por acabar disfarçado de ecrã de motorista é
 * uma mentira, e foi essa que causou a confusão toda.
 */
function FleetEmPreparacao() {
  return (
    <div className="zr-app" style={{ minHeight: '100vh', padding: '20px' }}>
      <section className="zr-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
        <p className="zr-kicker">Modo Dono de Frota</p>
        <h2 className="zr-section-title">O painel de frota está temporariamente indisponível</h2>
        <p className="zr-muted" style={{ marginTop: 8 }}>
          A tua frota não foi perdida. O painel volta assim que estiver pronto.
        </p>
      </section>
    </div>
  );
}

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
  const navigate = useNavigate();

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
      {/* O grito tem de estar armado desde que o app abre — não só quando há
          corrida aceite. Vive aqui, na raiz, e não dentro do painel do
          passageiro: o motorista também precisa dele. */}
      <ScreamGuard
        userId={dbUser?.id}
        rideId={ride.rideId}
        emCorrida={
          ride.status === RideStatus.ACCEPTED ||
          ride.status === RideStatus.PICKING_UP ||
          ride.status === RideStatus.IN_PROGRESS
        }
        emergencyPhone={profile?.emergency_contact_phone ?? undefined}
        driverName={ride.driverName}
        telefonePassageiro={profile?.phone ?? undefined}
      />

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
              // ⚠️ O `&& FLEET_DASHBOARD_ENABLED` que aqui estava era o bug.
              // Com a flag a `false`, esta condição falhava e o render caía no
              // ramo de baixo — o `DriverHome`. Um dono de frota via o ecrã de
              // motorista. Agora o ramo de frota é dele e de mais ninguém: ou
              // vê o painel, ou vê um aviso honesto. Nunca o ecrã errado.
              FLEET_DASHBOARD_ENABLED ? (
                <FleetDashboard
                  ownerId={dbUser?.id ?? ''}
                  ownerName={profile?.name}
                />
              ) : (
                <FleetEmPreparacao />
              )
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

      {/* Kaze: animações + síntese de voz isoladas — um crash não bloqueia a app */}
      {showKaze && (
        <ErrorBoundary name="KazeMascot" compact fallback={null}>
          <Suspense fallback={null}>
            <KazeMascot
              role={effectiveRole}
              rideStatus={ride.status}
              dataSaver={dataSaver}
              userName={profile?.name}
              userId={dbUser?.id}
              onRequestRide={requestRide}
              onCancelRide={cancelRide}
              onNavigate={(path) => navigate(path)}
              userLocation={ride.pickupCoords || (profile?.last_known_lat && profile?.last_known_lng ? { lat: profile.last_known_lat, lng: profile.last_known_lng } : null)}
            />
          </Suspense>
        </ErrorBoundary>
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
