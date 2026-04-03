// =============================================================================
// MOTOGO v3.0 — src/components/EscolarMonitor.tsx
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

interface EscolarMonitorProps {
  contractId:    string;
  contractTitle: string;
  activeRide?:   RideState;   // corrida activa associada a este contrato (opcional)
}

const EscolarMonitor: React.FC<EscolarMonitorProps> = ({
  contractId, contractTitle, activeRide
}) => {
  const [session,    setSession]    = useState<SchoolTrackingSession | null>(null);
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

  const loadActiveSession = async () => {
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
      `🚗 Podes acompanhar a corrida escolar de "${contractTitle}" em tempo real:\n${trackingUrl}\n\nLink válido por 12 horas. — MotoGo AI`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  // ─── Sem sessão activa ────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="mt-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center gap-4 bg-primary/5 border border-primary/15 p-5 rounded-[2rem] text-left hover:bg-primary/10 transition-all"
          >
            <div className="w-12 h-12 bg-primary/20 border border-primary/30 rounded-2xl flex items-center justify-center text-xl text-white shrink-0">
              🛡️
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">Partilhar com pais</p>
              <p className="text-[9px] text-primary/60 font-bold uppercase tracking-widest">
                Gerar link de monitorização
              </p>
            </div>
          </button>
        ) : (
          <div className="bg-surface-container-low border border-outline-variant/20 rounded-[2.5rem] p-5 space-y-4">
            <p className="font-black text-on-surface text-sm">Partilhar rastreamento</p>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Nome dos pais (obrigatório)"
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="tel"
                placeholder="Telefone (opcional)"
                value={parentPhone}
                onChange={e => setParentPhone(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 border border-outline-variant/30 rounded-2xl font-black text-xs text-outline uppercase"
              >
                Cancelar
              </button>
              <button
                onClick={createSession}
                disabled={!parentName || creating}
                className="flex-1 py-3 gilded-gradient text-on-primary rounded-2xl font-black text-xs uppercase disabled:opacity-50"
              >
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
    <div className="mt-4 bg-surface-container-lowest rounded-[2.5rem] p-5 space-y-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/50/10 rounded-full blur-[60px]" />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-primary animate-pulse shrink-0" />
        <div className="flex-1">
          <p className="text-[8px] font-black text-primary uppercase tracking-widest">
            Monitorização activa
          </p>
          <p className="text-white font-black text-sm">
            {session.parent_name} está a acompanhar
          </p>
        </div>
      </div>

      {/* Status da corrida */}
      {activeRide && activeRide.status !== RideStatus.IDLE && (
        <div className="bg-surface-container-low/5 rounded-2xl p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {activeRide.status === RideStatus.IN_PROGRESS ? '🚗' :
               activeRide.status === RideStatus.PICKING_UP ? '📍' :
               activeRide.status === RideStatus.COMPLETED ? '✅' : '⏳'}
            </span>
            <p className="text-[10px] font-bold text-white/70">
              {activeRide.status === RideStatus.PICKING_UP  ? 'Motorista a caminho da escola' :
               activeRide.status === RideStatus.IN_PROGRESS ? `Em rota para ${activeRide.destination?.split(',')[0]}` :
               activeRide.status === RideStatus.COMPLETED   ? 'Corrida concluída ✓' :
               'Corrida em curso'}
            </p>
          </div>
        </div>
      )}

      {/* Link */}
      <div className="bg-surface-container-low/5 rounded-2xl p-3">
        <p className="text-[8px] font-black text-primary/70 uppercase mb-1">Link dos pais</p>
        <p className="text-[9px] text-white/50 font-mono break-all">
          {trackingUrl}
        </p>
      </div>

      {/* Botões de partilha */}
      <div className="flex gap-3">
        <button
          onClick={copyLink}
          className={`flex-1 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest transition-all ${
            linkCopied
              ? 'bg-primary/100 text-white'
              : 'bg-surface-container-low/10 text-white hover:bg-surface-container-low/20'
          }`}
        >
          {linkCopied ? '✓ Copiado!' : 'Copiar link'}
        </button>
        <button
          onClick={shareWhatsApp}
          className="flex-1 py-3 bg-primary text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-primary/100 transition-all"
        >
          WhatsApp
        </button>
      </div>

      {/* Expirar */}
      <button
        onClick={expireSession}
        className="w-full text-[8px] text-white/20 font-black uppercase tracking-widest hover:text-white/40 transition-all"
      >
        Desactivar monitorização
      </button>
    </div>
  );
};

export default EscolarMonitor;
