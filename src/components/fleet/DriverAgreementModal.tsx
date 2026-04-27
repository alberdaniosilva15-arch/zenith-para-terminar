import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FleetAgreementType } from '../../types';

interface DriverAgreementModalProps {
  agreementId: string;
  fleetName: string;
  onClose: () => void;
  onResolved: () => Promise<void> | void;
}

const DriverAgreementModal: React.FC<DriverAgreementModalProps> = ({
  agreementId,
  fleetName,
  onClose,
  onResolved,
}) => {
  const [agreementType, setAgreementType] = useState<FleetAgreementType>('minimal');
  const [blackoutStart, setBlackoutStart] = useState('12:00');
  const [blackoutEnd, setBlackoutEnd] = useState('16:00');
  const [loading, setLoading] = useState(false);

  const handleDecision = async (status: 'accepted' | 'rejected') => {
    setLoading(true);
    try {
      await supabase
        .from('fleet_driver_agreements')
        .update({
          status,
          agreement_type: agreementType,
          privacy_blackout_start: blackoutStart,
          privacy_blackout_end: blackoutEnd,
        })
        .eq('id', agreementId);

      await onResolved();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-[2rem] bg-[#0A0A0A] border border-white/10 p-6 text-white">
        <p className="text-[9px] uppercase tracking-[0.22em] text-primary/70 font-black">Convite de frota</p>
        <h3 className="text-lg font-black mt-2">{fleetName} quer associar-te a uma viatura</h3>
        <p className="text-sm text-white/60 mt-3">
          Escolhe o nivel de partilha que te deixa confortavel. Podes mudar mais tarde.
        </p>

        <div className="mt-5 space-y-3">
          {([
            ['minimal', 'Acordo Minimo', 'O dono ve apenas se o carro esta activo ou inactivo.'],
            ['weekly', 'Acordo Semanal', 'Partilha parcial com blackout diario e operacao controlada.'],
            ['transparent', 'Acordo Transparente', 'Partilha total de operacao, lucro e rotas.'],
          ] as Array<[FleetAgreementType, string, string]>).map(([value, title, description]) => (
            <button
              key={value}
              onClick={() => setAgreementType(value)}
              className={`w-full rounded-2xl border p-4 text-left ${
                agreementType === value ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5'
              }`}
            >
              <p className="font-black text-sm">{title}</p>
              <p className="text-[11px] text-white/60 mt-1">{description}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <TimeField label="Blackout inicio" value={blackoutStart} onChange={setBlackoutStart} />
          <TimeField label="Blackout fim" value={blackoutEnd} onChange={setBlackoutEnd} />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={() => void handleDecision('accepted')}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest"
          >
            Aceitar
          </button>
          <button
            onClick={() => void handleDecision('rejected')}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-black text-[10px] uppercase tracking-widest"
          >
            Recusar
          </button>
        </div>
      </div>
    </div>
  );
};

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/45 font-black mb-2">{label}</p>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none"
      />
    </div>
  );
}

export default DriverAgreementModal;
