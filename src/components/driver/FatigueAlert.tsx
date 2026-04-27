import React from 'react';

interface FatigueAlertProps {
  isOnline: boolean;
  onlineHours: number;
}

const FatigueAlert: React.FC<FatigueAlertProps> = ({ isOnline, onlineHours }) => {
  if (!isOnline || onlineHours < 4) {
    return null;
  }

  const isCritical = onlineHours >= 8;

  return (
    <div className={`rounded-[2rem] border p-4 ${
      isCritical
        ? 'border-red-500/30 bg-red-500/10 text-red-100'
        : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100'
    }`}>
      <p className="text-[9px] uppercase tracking-[0.22em] font-black">
        {isCritical ? 'Alerta forte' : 'Alerta suave'}
      </p>
      <p className="text-sm font-black mt-2">
        {isCritical
          ? '🛑 Descansa. Seguranca em primeiro lugar.'
          : '⚡ Para 10 min - a eficiencia costuma cair depois de 4 horas continuas.'}
      </p>
      <p className="text-[11px] mt-2 opacity-80">
        Tempo online continuo estimado: {onlineHours.toFixed(1)} h
      </p>
    </div>
  );
};

export default FatigueAlert;
