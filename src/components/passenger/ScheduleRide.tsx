// =============================================================================
// ZENITH RIDE v3.3 — ScheduleRide.tsx
// Feature: Agendar corrida para data/hora futura
// Inspirado em: Uber Scheduled Rides
// =============================================================================

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar, Clock, MapPin, CheckCircle, X, AlertCircle } from 'lucide-react';

interface ScheduleRideProps {
  userId:      string;
  pickupName:  string;
  destName:    string;
  pickupCoords: { lat: number; lng: number } | null;
  destCoords:   { lat: number; lng: number } | null;
  onClose:     () => void;
  onScheduled: () => void;
}

const ScheduleRide: React.FC<ScheduleRideProps> = ({
  userId, pickupName, destName, pickupCoords, destCoords, onClose, onScheduled,
}) => {
  const [date, setDate]       = useState('');
  const [time, setTime]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekdays' | 'weekly'>('none');

  // Data mínima = amanhã
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  // Data máxima = 30 dias
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + 30);
  const maxDate = maxDateObj.toISOString().split('T')[0];

  const handleSchedule = async () => {
    if (!date || !time || !pickupName || !destName) {
      setError('Preenche todos os campos: data, hora, partida e destino.');
      return;
    }
    if (!pickupCoords || !destCoords) {
      setError('Selecciona a partida e o destino no mapa primeiro.');
      return;
    }

    const scheduledAt = new Date(`${date}T${time}:00`);
    const now = new Date();
    if (scheduledAt <= now) {
      setError('A data e hora devem ser no futuro.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error: dbError } = await supabase.from('scheduled_rides').insert({
        user_id:         userId,
        pickup_address:  pickupName,
        pickup_lat:      pickupCoords.lat,
        pickup_lng:      pickupCoords.lng,
        dest_address:    destName,
        dest_lat:        destCoords.lat,
        dest_lng:        destCoords.lng,
        scheduled_at:    scheduledAt.toISOString(),
        recurrence:      recurrence,
        status:          'pending',
      });

      if (dbError) {
        // Tabela pode não existir — dar feedback ao utilizador
        if (dbError.code === '42P01') {
          setError('Funcionalidade em preparação. A tabela será configurada em breve.');
        } else {
          setError(`Erro ao agendar: ${dbError.message}`);
        }
      } else {
        setSuccess(true);
        setTimeout(() => {
          onScheduled();
          onClose();
        }, 2000);
      }
    } catch {
      setError('Erro de ligação. Verifica a tua internet.');
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
        <div className="bg-surface-container-low rounded-[2rem] p-8 max-w-sm w-full shadow-2xl border border-outline-variant/20 text-center space-y-4 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 mx-auto bg-green-500/15 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h3 className="text-lg font-black text-on-surface">Corrida Agendada!</h3>
          <p className="text-sm text-on-surface-variant font-bold">
            {new Date(`${date}T${time}`).toLocaleDateString('pt-AO', {
              weekday: 'long', day: 'numeric', month: 'long',
            })} às {time}
          </p>
          <p className="text-xs text-on-surface-variant/70 font-bold">
            Receberás uma notificação 30 minutos antes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center animate-in fade-in duration-300">
      <div className="bg-surface-container-low rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 max-w-sm w-full shadow-2xl border border-outline-variant/20 space-y-5 animate-in slide-in-from-bottom-10 duration-300 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/15 rounded-full flex items-center justify-center">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-black text-on-surface">Agendar Corrida</h3>
              <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-widest">Até 30 dias no futuro</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-container-lowest flex items-center justify-center text-on-surface-variant/50 hover:text-on-surface transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rota */}
        <div className="bg-surface-container-lowest rounded-2xl p-4 space-y-2 border border-outline-variant/10">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs font-black text-on-surface truncate">{pickupName || 'Selecciona partida'}</span>
          </div>
          <div className="ml-1 pl-2 border-l-2 border-dashed border-outline-variant/30 h-3" />
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs font-black text-on-surface truncate">{destName || 'Selecciona destino'}</span>
          </div>
        </div>

        {/* Data */}
        <div className="space-y-2">
          <label className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Data da corrida
          </label>
          <input
            type="date"
            min={minDate}
            max={maxDate}
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold text-on-surface outline-none focus:border-primary transition-all"
          />
        </div>

        {/* Hora */}
        <div className="space-y-2">
          <label className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest flex items-center gap-1">
            <Clock className="w-3 h-3" /> Hora de partida
          </label>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold text-on-surface outline-none focus:border-primary transition-all"
          />
        </div>

        {/* Recorrência */}
        <div className="space-y-2">
          <label className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">
            Repetir
          </label>
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'none',     label: 'Apenas uma vez' },
              { value: 'daily',    label: 'Todos os dias' },
              { value: 'weekdays', label: 'Dias úteis' },
              { value: 'weekly',   label: 'Semanal' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setRecurrence(opt.value as any)}
                className={`px-3 py-1.5 rounded-full text-[9px] font-black transition-all border ${
                  recurrence === opt.value
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-surface-container-lowest text-on-surface-variant/70 border-outline-variant/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Erro */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400 font-bold">{error}</p>
          </div>
        )}

        {/* Botão */}
        <button
          onClick={handleSchedule}
          disabled={saving || !date || !time || !pickupName || !destName}
          className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_15px_30px_rgba(37,99,235,0.3)] disabled:opacity-50 active:scale-98 transition-all flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              A agendar...
            </>
          ) : (
            <>
              <Calendar className="w-4 h-4" />
              Agendar Corrida
            </>
          )}
        </button>

        <p className="text-[9px] text-center text-on-surface-variant/50 font-bold">
          O preço será calculado no momento da corrida com base no trânsito real
        </p>
      </div>
    </div>
  );
};

export default ScheduleRide;
