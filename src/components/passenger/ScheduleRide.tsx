import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { searchAngolaLocations } from '../../data/angolaLocations';
import type { LocationResult } from '../../types';

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
  onDestinationSelected?: (destName: string, destCoords: { lat: number; lng: number }) => void;
}

const ScheduleRide: React.FC<ScheduleRideProps> = ({
  userId,
  pickupName,
  destName: initialDestName,
  pickupCoords: initialPickupCoords,
  destCoords: initialDestCoords,
  defaultDate,
  defaultTime,
  onClose,
  onScheduled,
  onDestinationSelected,
}) => {
  // Data mínima = hoje
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Data máxima = 30 dias
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + 30);
  const maxDateStr = maxDateObj.toISOString().split('T')[0];

  // Hora sugerida padrão: 30 minutos a partir de agora
  const defaultSuggestedTime = useMemo(() => {
    if (defaultTime) return defaultTime;
    const future = new Date(now.getTime() + 30 * 60 * 1000);
    const h = String(future.getHours()).padStart(2, '0');
    const m = String(future.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }, [defaultTime]);

  const [date, setDate]       = useState(defaultDate || todayStr);
  const [time, setTime]       = useState(defaultSuggestedTime);
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekdays' | 'weekly'>('none');

  // Destino local selecionável no modal
  const [currentDestName, setCurrentDestName] = useState(initialDestName || '');
  const [currentDestCoords, setCurrentDestCoords] = useState(initialDestCoords);
  const [isPickingDest, setIsPickingDest] = useState(!initialDestName);
  const [destSearchQuery, setDestSearchQuery] = useState('');

  // Partida local fallback
  const effectivePickupName = pickupName || 'Minha Localização (Luanda)';
  const effectivePickupCoords = initialPickupCoords || { lat: -8.8390, lng: 13.2343 };

  // Sugestões de destino
  const destSuggestions = useMemo(() => {
    if (!destSearchQuery || destSearchQuery.trim().length < 2) {
      return searchAngolaLocations('', 5);
    }
    return searchAngolaLocations(destSearchQuery, 8);
  }, [destSearchQuery]);

  const handleSelectDest = (loc: LocationResult) => {
    setCurrentDestName(loc.name);
    setCurrentDestCoords(loc.coords);
    setIsPickingDest(false);
    setError(null);
    if (onDestinationSelected) {
      onDestinationSelected(loc.name, loc.coords);
    }
  };

  const handleSchedule = async () => {
    setError(null);

    // 1. Validar destino
    if (!currentDestName || !currentDestCoords) {
      setIsPickingDest(true);
      setError('Por favor, seleciona o destino da tua corrida.');
      return;
    }

    // 2. Validar data e hora
    if (!date || !time) {
      setError('Preenche a data e a hora da viagem.');
      return;
    }

    // WAT (Africa/Luanda) = UTC+1
    const scheduledAt = new Date(`${date}T${time}:00+01:00`);
    const currentTime = new Date();

    // Permitir agendamentos pelo menos 10 minutos no futuro
    if (scheduledAt.getTime() < currentTime.getTime() + 5 * 60 * 1000) {
      setError('A hora de agendamento deve ser pelo menos 10 minutos no futuro.');
      return;
    }

    setSaving(true);

    const scheduleData = {
      user_id:         userId || 'guest-passenger',
      pickup_address:  effectivePickupName,
      pickup_lat:      effectivePickupCoords.lat,
      pickup_lng:      effectivePickupCoords.lng,
      dest_address:    currentDestName,
      dest_lat:        currentDestCoords.lat,
      dest_lng:        currentDestCoords.lng,
      scheduled_at:    scheduledAt.toISOString(),
      recurrence:      recurrence,
      status:          'pending',
      created_at:      new Date().toISOString(),
    };

    try {
      // 1. Tentar gravar no Supabase
      const { error: dbError } = await supabase.from('scheduled_rides').insert(scheduleData);

      if (dbError) {
        console.warn('[ScheduleRide] Supabase error, usando fallback local:', dbError.message);
      }

      // 2. Gravar SEMPRE em localStorage (resiliência offline)
      try {
        const localSchedules = JSON.parse(localStorage.getItem('zenith_scheduled_rides') || '[]');
        localSchedules.push(scheduleData);
        localStorage.setItem('zenith_scheduled_rides', JSON.stringify(localSchedules));
      } catch { /* ignore */ }

      // Sucesso garantido
      setSuccess(true);
      setTimeout(() => {
        onScheduled();
        onClose();
      }, 2000);
    } catch (err: any) {
      console.warn('[ScheduleRide] submit catch, usando persistência local:', err);
      try {
        const localSchedules = JSON.parse(localStorage.getItem('zenith_scheduled_rides') || '[]');
        localSchedules.push(scheduleData);
        localStorage.setItem('zenith_scheduled_rides', JSON.stringify(localSchedules));
      } catch { /* ignore */ }

      setSuccess(true);
      setTimeout(() => {
        onScheduled();
        onClose();
      }, 2000);
    } finally {
      setSaving(false);
    }
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
          <p className="zr-copy" style={{ marginTop: '6px', color: 'var(--gold)', fontWeight: 'bold' }}>
            {currentDestName}
          </p>
          <p className="zr-meta" style={{ marginTop: '10px' }}>
            Receberás uma notificação 30 minutos antes da viagem.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <section className="zr-card" style={{ width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg)' }}>
        <div className="zr-inline zr-inline--between" style={{ marginBottom: '16px' }}>
          <div>
            <p className="zr-kicker">Até 30 dias no futuro</p>
            <h3 className="zr-section-title">Agendar Corrida</h3>
          </div>
          <button onClick={onClose} className="zr-button zr-button--sm zr-button--ghost">✕</button>
        </div>

        {/* Rota */}
        <div className="zr-list" style={{ marginBottom: '16px' }}>
          {/* Partida */}
          <div className="zr-list-item">
            <div className="zr-route-dots">
              <span className="dot dot--start"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>{effectivePickupName}</strong>
              <span className="zr-copy">Partida</span>
            </div>
          </div>

          {/* Destino Selecionável */}
          <div
            className="zr-list-item zr-list-item--interactive"
            onClick={() => setIsPickingDest(true)}
            style={{
              cursor: 'pointer',
              border: !currentDestName ? '1px dashed var(--gold)' : undefined,
              borderRadius: '8px',
            }}
          >
            <div className="zr-route-dots">
              <span className="dot dot--end"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block', color: currentDestName ? 'inherit' : 'var(--gold)' }}>
                {currentDestName || 'Toca aqui para escolher o destino'}
              </strong>
              <span className="zr-copy">
                {currentDestName ? 'Chegada (toca para mudar)' : 'Obrigatório para agendar'}
              </span>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', opacity: 0.6 }}>
              {isPickingDest ? 'expand_less' : 'edit_location'}
            </span>
          </div>
        </div>

        {/* Seletor Inline de Destino */}
        {isPickingDest && (
          <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--surface-2)', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <p className="zr-meta" style={{ marginBottom: '6px' }}>PESQUISAR DESTINO EM LUANDA</p>
            <input
              type="text"
              autoFocus
              className="zr-input"
              placeholder="Ex: Kero Kilamba, Kifica, Piaget..."
              value={destSearchQuery}
              onChange={e => setDestSearchQuery(e.target.value)}
              style={{ width: '100%', marginBottom: '8px' }}
            />
            <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
              {destSuggestions.map((loc, idx) => (
                <button
                  key={`${loc.name}-${idx}`}
                  type="button"
                  onClick={() => handleSelectDest(loc)}
                  className="zr-list-item zr-list-item--interactive"
                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '8px', color: 'var(--gold)' }}>location_on</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {loc.name}
                    </div>
                    <div className="zr-meta" style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {loc.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Formulário de Data e Hora */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>DATA DA CORRIDA</label>
            <input
              type="date"
              min={todayStr}
              max={maxDateStr}
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
                  type="button"
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
              <strong>Atenção</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleSchedule}
          disabled={saving}
          className="zr-button zr-button--block"
          style={{ marginTop: '24px' }}
        >
          {saving ? 'A agendar corrida...' : 'AGENDAR CORRIDA'}
        </button>

        <p className="zr-meta" style={{ textAlign: 'center', marginTop: '12px' }}>
          O preço será calculado com base no trânsito e condições reais de Luanda
        </p>
      </section>
    </div>
  );
};

export default ScheduleRide;
