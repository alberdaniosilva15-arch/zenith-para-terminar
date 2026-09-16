// =============================================================================
// ZENITH RIDE v3.3 — src/components/passenger/PassengerModals.tsx
//
// Renderização condicional dos modais secundários do passageiro:
// ScheduleRide, ReferralModal, PrivateDriverModal, CharterModal e CargoModal.
// Extraído de PassengerHome.tsx (SRP) — comportamento inalterado.
// =============================================================================

import React, { Suspense } from 'react';
import { ReferralModal } from '../ReferralModal';
import PrivateDriverModal from './PrivateDriverModal';
import CharterModal from './CharterModal';
import CargoModal from './CargoModal';
import type { PremiumServiceType } from './PassengerQuickAccess';
import type { LatLng } from '../../types';

const ScheduleRide = React.lazy(() => import('./ScheduleRide'));

interface PassengerModalsProps {
  userId: string;
  pickupName: string;
  destName: string;
  pickupCoords: LatLng | null;
  destCoords: LatLng | null;

  showSchedule: boolean;
  scheduleDefaults: { date?: string; time?: string } | null;
  onCloseSchedule: () => void;
  onScheduled: () => void;
  onDestinationSelected: (name: string, coords: LatLng) => void;

  showReferral: boolean;
  onCloseReferral: () => void;

  openPremiumService: PremiumServiceType | null;
  onClosePremiumService: () => void;
}

const PassengerModals: React.FC<PassengerModalsProps> = ({
  userId,
  pickupName,
  destName,
  pickupCoords,
  destCoords,
  showSchedule,
  scheduleDefaults,
  onCloseSchedule,
  onScheduled,
  onDestinationSelected,
  showReferral,
  onCloseReferral,
  openPremiumService,
  onClosePremiumService,
}) => {
  return (
    <>
      {/* Modal de agendamento */}
      {showSchedule && (
        <Suspense fallback={null}>
          <ScheduleRide
            userId={userId}
            pickupName={pickupName}
            destName={destName}
            pickupCoords={pickupCoords}
            destCoords={destCoords}
            defaultDate={scheduleDefaults?.date}
            defaultTime={scheduleDefaults?.time}
            onClose={onCloseSchedule}
            onScheduled={onScheduled}
            onDestinationSelected={onDestinationSelected}
          />
        </Suspense>
      )}

      {/* Modal Traz o Mano */}
      {showReferral && (
        <ReferralModal
          userId={userId}
          onClose={onCloseReferral}
        />
      )}

      {openPremiumService === 'private_driver' && (
        <PrivateDriverModal
          userId={userId}
          pickupName={pickupName}
          destName={destName}
          pickupCoords={pickupCoords}
          destCoords={destCoords}
          onClose={onClosePremiumService}
        />
      )}

      {openPremiumService === 'charter' && (
        <CharterModal
          userId={userId}
          pickupName={pickupName}
          destName={destName}
          pickupCoords={pickupCoords}
          destCoords={destCoords}
          onClose={onClosePremiumService}
        />
      )}

      {openPremiumService === 'cargo' && (
        <CargoModal
          userId={userId}
          pickupName={pickupName}
          destName={destName}
          pickupCoords={pickupCoords}
          destCoords={destCoords}
          onClose={onClosePremiumService}
        />
      )}
    </>
  );
};

export default PassengerModals;
