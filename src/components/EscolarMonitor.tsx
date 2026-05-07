// =============================================================================
// ZENITH RIDE v3.0 — src/components/EscolarMonitor.tsx
//
// Monitorização em tempo real de contratos escolares.
// Gera um link único para pais acompanharem a corrida sem precisar de conta.
//
// Integração em Contract.tsx:
//   Substitui (ou adiciona ao lado) do ecrã de contrato escolar actual.
//   import EscolarMonitor from './EscolarMonitor';
//
//   // Dentro do card do contrato, quando parent_monitoring === true:
//   <EscolarMonitor contractId={c.id} contractTitle={c.title} />
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rideService } from '../services/rideService';
import type { RideState, SchoolTrackingSession } from '../types';
import { RideStatus } from '../types';

interface EscolarSessionState extends SchoolTrackingSession {
  ride_status?: string;
}

interface EscolarMonitorProps {
  contractId:    string;
  contractTitle: string;
  activeRide?:   RideState;   // corrida activa associada a este contrato (opcional)
}

const EscolarMonitor: React.FC<EscolarMonitorProps> = ({
  contractId, contractTitle, activeRide
}) => {
  const [session,    setSession]    = useState<EscolarSessionState | null>(null);
  const [creating,   setCreating]   = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [parentName, setParentName] = useState('');
  const [parentPhone,setParentPhone]= useState('');
  const [showForm,   setShowForm]   = useState(false);

  useEffect(() => {
    let mounted = true;
    let sessionChannel: any = null;
    let rideUnsub: (() => void) | null = null;

    const cleanup = () => {
      if (sessionChannel) { supabase.removeChannel(sessionChannel); sessionChannel = null; }
      if (rideUnsub) { rideUnsub(); rideUnsub = null; }
    };

    const handleSessionRow = (s: any) => {
      if (!mounted) return;
      if (!s) { setSession(null); return; }
      if (s.status !== 'active' || new Date(s.expires_at) < new Date()) { setSession(null); return; }
      setSession(s as SchoolTrackingSession);

      // Subscrever corrida associada (se houver)
      if (rideUnsub) { rideUnsub(); rideUnsub = null; }
      if (s.ride_id) {
        rideUnsub = rideService.subscribeToRide(s.ride_id, (updated) => {
          // actualizar session com estado da corrida
          setSession(prev => prev ? ({ ...prev, ride_status: updated.status }) : prev);
        });
      }
    };

    (async () => {
      const { data } = await supabase
        .from('school_tracking_sessions')
        .select('*')
        .eq('contract_id', contractId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      handleSessionRow(data);

      sessionChannel = supabase.channel(`escolar-monitor:${contractId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'school_tracking_sessions', filter: `contract_id=eq.${contractId}` }, (p: any) => {
          handleSessionRow(p.new);
        })
        .subscribe();
    })();

    return () => { mounted = false; cleanup(); };
  }, [contractId]);

  // loadActiveSession — reutilizada em expireSession para confirmar que não há nova sessão
  const loadActiveSession = async (): Promise<void> => {
    const { data } = await supabase
      .from('school_tracking_sessions')
      .select('*')
      .eq('contract_id', contractId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setSession(data as SchoolTrackingSession | null);
  };

  const createSession = async () => {
    if (!parentName) return;
    setCreating(true);

    const { data, error } = await supabase
      .from('school_tracking_sessions')
      .insert({
        contract_id:  contractId,
        ride_id:      activeRide?.rideId ?? null,
        parent_name:  parentName,
        parent_phone: parentPhone || null,
        status:       'active',
        expires_at:   new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    setCreating(false);
    if (!error && data) {
      setSession(data as SchoolTrackingSession);
      setShowForm(false);
    }
  };

  const expireSession = async () => {
    if (!session) return;
    await supabase
      .from('school_tracking_sessions')
      .update({ status: 'expired' })
      .eq('id', session.id);
    setSession(null);
    // Recarregar para confirmar que não há nova sessão activa criada entretanto
    await loadActiveSession();
  };

  const trackingUrl = session
    ? `${window.location.origin}/track/${session.public_token}`
    : null;

  const copyLink = async () => {
    if (!trackingUrl) return;
    await navigator.clipboard.writeText(trackingUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 3000);
  };

  const shareWhatsApp = () => {
    if (!trackingUrl) return;
    const msg = encodeURIComponent(
      `🚗 Podes acompanhar a corrida escolar de "${contractTitle}" em tempo real:\n${trackingUrl}\n\nLink válido por 12 horas. — Zenith Ride`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  // ─── Sem sessão activa ────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{ marginTop: '16px' }}>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} className="zr-card" style={{ width: '100%', textAlign: 'left', padding: '16px' }}>
            <div className="zr-inline" style={{ gap: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                🛡️
              </div>
              <div>
                <strong style={{ display: 'block' }}>Partilhar com pais</strong>
                <span className="zr-meta" style={{ color: 'var(--gold)' }}>Gerar link de monitorização</span>
              </div>
            </div>
          </button>
        ) : (
          <div className="zr-card">
            <h3 className="zr-section-title" style={{ fontSize: '16px', marginBottom: '16px' }}>Partilhar rastreamento</h3>
            <div className="zr-stack" style={{ gap: '12px' }}>
              <input
                type="text"
                placeholder="Nome dos pais (obrigatório)"
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                className="zr-input"
              />
              <input
                type="tel"
                placeholder="Telefone (opcional)"
                value={parentPhone}
                onChange={e => setParentPhone(e.target.value)}
                className="zr-input"
              />
            </div>
            <div className="zr-inline" style={{ marginTop: '16px', gap: '12px' }}>
              <button onClick={() => setShowForm(false)} className="zr-button zr-button--secondary" style={{ flex: 1 }}>
                Cancelar
              </button>
              <button onClick={createSession} disabled={!parentName || creating} className="zr-button" style={{ flex: 1 }}>
                {creating ? 'A criar...' : 'Gerar link'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Sessão activa ────────────────────────────────────────────────────────
  return (
    <div className="zr-card" style={{ marginTop: '16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: '120px', height: '120px', background: 'var(--gold)', borderRadius: '50%', filter: 'blur(60px)', opacity: 0.1 }} />

      {/* Header */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--success)', borderRadius: '50%' }} className="animate-pulse" />
        <div>
          <p className="zr-kicker" style={{ margin: 0, color: 'var(--success)' }}>Monitorização Activa</p>
          <strong style={{ fontSize: '14px' }}>{session.parent_name} está a acompanhar</strong>
        </div>
      </div>

      {/* Status da corrida */}
      {activeRide && activeRide.status !== RideStatus.IDLE && (
        <div className="zr-alert-box zr-alert-box--info" style={{ marginBottom: '16px' }}>
          <div className="zr-inline" style={{ gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>
              {activeRide.status === RideStatus.IN_PROGRESS ? '🚗' :
               activeRide.status === RideStatus.PICKING_UP ? '📍' :
               activeRide.status === RideStatus.COMPLETED ? '✅' : '⏳'}
            </span>
            <p style={{ fontSize: '12px', fontWeight: 'bold' }}>
              {activeRide.status === RideStatus.PICKING_UP  ? 'Motorista a caminho da escola' :
               activeRide.status === RideStatus.IN_PROGRESS ? `Em rota para ${activeRide.destination?.split(',')[0]}` :
               activeRide.status === RideStatus.COMPLETED   ? 'Corrida concluída ✓' :
               'Corrida em curso'}
            </p>
          </div>
        </div>
      )}

      {/* Link */}
      <div style={{ padding: '12px', background: 'var(--surface-3)', borderRadius: '12px', marginBottom: '16px' }}>
        <p className="zr-meta" style={{ marginBottom: '4px' }}>Link dos pais</p>
        <p style={{ fontSize: '10px', wordBreak: 'break-all', fontFamily: 'monospace', opacity: 0.8 }}>{trackingUrl}</p>
      </div>

      {/* Botões de partilha */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <button onClick={copyLink} className="zr-button zr-button--secondary" style={{ flex: 1, backgroundColor: linkCopied ? 'var(--gold)' : 'transparent', color: linkCopied ? '#000' : 'inherit' }}>
          {linkCopied ? '✓ Copiado!' : 'Copiar link'}
        </button>
        <button onClick={shareWhatsApp} className="zr-button" style={{ flex: 1, backgroundColor: '#25D366', color: '#fff' }}>
          WhatsApp
        </button>
      </div>

      {/* Expirar */}
      <button onClick={expireSession} className="zr-button zr-button--danger zr-button--block" style={{ backgroundColor: 'transparent', border: '1px dashed var(--danger-soft)' }}>
        Desactivar monitorização
      </button>
    </div>
  );
};

export default EscolarMonitor;
