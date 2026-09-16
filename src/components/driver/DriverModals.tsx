// =============================================================================
// ZENITH RIDE v3.3 — src/components/driver/DriverModals.tsx
//
// Camada de modais de gestão do cockpit do motorista:
//   • DriverDocumentsForm   — submissão de dados do carro/BI
//   • DriverAgreementModal  — acordo pendente com frota
//   • DriverRecharge        — recarga de crédito operacional
//
// Extraído de DriverHome.tsx (SRP). A consulta do acordo pendente permanece no
// cockpit (é estado de domínio); este componente só o apresenta.
// =============================================================================

import React from 'react';
import { DriverDocumentsForm } from '../DriverDocumentsForm';
import DriverAgreementModal from '../fleet/DriverAgreementModal';
import DriverRecharge from './DriverRecharge';
import type { FleetDriverAgreementRecord } from '../../types';

interface DriverModalsProps {
  driverId: string;

  showDocsForm: boolean;
  onCloseDocsForm: () => void;
  onDocsSuccess: (status: string) => void;

  pendingAgreement: (FleetDriverAgreementRecord & { fleet_name?: string | null }) | null;
  onCloseAgreement: () => void;
  onAgreementResolved: () => void;

  showRecharge: boolean;
  onCloseRecharge: () => void;
  onRechargeSuccess: () => void;
}

const DriverModals: React.FC<DriverModalsProps> = ({
  driverId,
  showDocsForm,
  onCloseDocsForm,
  onDocsSuccess,
  pendingAgreement,
  onCloseAgreement,
  onAgreementResolved,
  showRecharge,
  onCloseRecharge,
  onRechargeSuccess,
}) => {
  return (
    <>
      {/* Documentos */}
      {showDocsForm && (
        <DriverDocumentsForm
          driverId={driverId}
          onClose={onCloseDocsForm}
          onSuccess={(status) => onDocsSuccess(status as string)}
        />
      )}

      {/* Acordo com frota */}
      {pendingAgreement && (
        <DriverAgreementModal
          agreementId={pendingAgreement.id}
          fleetName={pendingAgreement.fleet_name ?? 'Nova frota'}
          onClose={onCloseAgreement}
          onResolved={onAgreementResolved}
        />
      )}

      {/* Recarga de crédito operacional */}
      {showRecharge && (
        <DriverRecharge
          onClose={onCloseRecharge}
          onSuccess={onRechargeSuccess}
        />
      )}
    </>
  );
};

export default DriverModals;
