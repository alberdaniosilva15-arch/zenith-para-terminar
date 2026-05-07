import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ScheduleRideProps {
  userId:      string;
  pickupName:  string;
  destName:    string;
  pickupCoords: { lat: number; lng: number } | null;
  destCoords:   { lat: number; lng: number } | null;
  defaultDate?: string;
  defaultTime?: string;
  onClose:     () => void;
  onScheduled: () => void;
}

const ScheduleRide: React.FC<ScheduleRideProps> = ({
  userId, pickupName, destName, pickupCoords, destCoords, defaultDate, defaultTime, onClose, onScheduled,
}) => {
  const [date, setDate]       = useState(defaultDate ?? '');
  const [time, setTime]       = useState(defaultTime ?? '');
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

    // WAT (Africa/Luanda) = UTC+1 — garantir que a hora agendada é
    // interpretada no fuso correcto independentemente do dispositivo.
    const scheduledAt = new Date(`${date}T${time}:00+01:00`);
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
    } catch (err) {
      console.warn('[ScheduleRide] submit:', err);
      setError('Erro de ligação. Verifica a tua internet.');
    } finally { setSaving(false); }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <section className="zr-card" style={{ width: '100%', maxWidth: '360px', textAlign: 'center', backgroundColor: 'var(--bg)' }}>
          <div style={{ display: 'inline-block', marginBottom: '14px', color: 'var(--success)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px' }}>check_circle</span>
          </div>
          <h2 className="zr-section-title" style={{ marginBottom: '8px' }}>Corrida Agendada!</h2>
          <p className="zr-copy">
            {new Date(`${date}T${time}:00+01:00`).toLocaleDateString('pt-AO', {
              weekday: 'long', day: 'numeric', month: 'long',
            })} às {time}
          </p>
          <p className="zr-meta" style={{ marginTop: '8px' }}>
            Receberás uma notificação 30 minutos antes.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <section className="zr-card" style={{ width: '100%', maxWidth: '400px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg)' }}>
        <div className="zr-inline zr-inline--between" style={{ marginBottom: '16px' }}>
          <div>
            <p className="zr-kicker">Até 30 dias no futuro</p>
            <h3 className="zr-section-title">Agendar Corrida</h3>
          </div>
          <button onClick={onClose} className="zr-button zr-button--sm zr-button--ghost">✕</button>
        </div>

        {/* Rota */}
        <div className="zr-list" style={{ marginBottom: '16px' }}>
          <div className="zr-list-item">
            <div className="zr-route-dots">
              <span className="dot dot--start"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>{pickupName || 'Partida'}</strong>
              <span className="zr-copy">Partida</span>
            </div>
          </div>
          <div className="zr-list-item">
            <div className="zr-route-dots">
              <span className="dot dot--end"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>{destName || 'Destino'}</strong>
              <span className="zr-copy">Chegada</span>
            </div>
          </div>
        </div>

        {/* Formulario */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>DATA DA CORRIDA</label>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={date}
              onChange={e => setDate(e.target.value)}
              className="zr-input"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>HORA DE PARTIDA</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="zr-input"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>REPETIR</label>
            <div className="zr-tabs" style={{ flexWrap: 'wrap' }}>
              {[
                { value: 'none',     label: '1 vez' },
                { value: 'daily',    label: 'Diário' },
                { value: 'weekdays', label: 'Dias úteis' },
                { value: 'weekly',   label: 'Semanal' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRecurrence(opt.value as 'none' | 'daily' | 'weekdays' | 'weekly')}
                  className={`zr-tab ${recurrence === opt.value ? 'is-active' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="zr-alert-box zr-alert-box--danger" style={{ marginTop: '16px' }}>
            <span className="material-symbols-outlined">error</span>
            <div className="zr-alert-content">
              <strong>Erro</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleSchedule}
          disabled={saving || !date || !time || !pickupName || !destName}
          className="zr-button zr-button--block"
          style={{ marginTop: '24px' }}
        >
          {saving ? 'A agendar...' : 'AGENDAR CORRIDA'}
        </button>

        <p className="zr-meta" style={{ textAlign: 'center', marginTop: '12px' }}>
          O preço será calculado no momento da corrida com base no trânsito real
        </p>
      </section>
    </div>
  );
};

export default ScheduleRide;
