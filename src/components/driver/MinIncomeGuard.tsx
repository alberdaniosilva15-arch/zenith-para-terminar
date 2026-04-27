import React from 'react';

interface MinIncomeGuardProps {
  isOnline: boolean;
  hasActiveRide: boolean;
  idleMinutes: number;
  suggestionLabel?: string | null;
  chanceLift?: number;
}

const MinIncomeGuard: React.FC<MinIncomeGuardProps> = ({
  isOnline,
  hasActiveRide,
  idleMinutes,
  suggestionLabel,
  chanceLift,
}) => {
  if (!isOnline || hasActiveRide || idleMinutes < 60) {
    return null;
  }

  return (
    <div className="rounded-[2rem] border border-blue-500/25 bg-blue-500/10 p-4 text-blue-100">
      <p className="text-[9px] uppercase tracking-[0.22em] font-black">Min Income Guard</p>
      <p className="text-sm font-black mt-2">
        Sabes que estas em zona baixa? Muda para {suggestionLabel ?? 'uma zona mais quente'}
        {chanceLift ? ` (+${chanceLift}% procura)` : ''}.
      </p>
      <p className="text-[11px] mt-2 opacity-80">
        Ociosidade actual: {idleMinutes} min sem corrida suficiente.
      </p>
    </div>
  );
};

export default MinIncomeGuard;
