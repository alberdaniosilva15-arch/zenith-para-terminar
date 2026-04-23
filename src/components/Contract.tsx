// =============================================================================
// ZENITH RIDE — Contract.tsx — MFUMU ZENITH EDITION
// Contratos IA: Escolar · Familiar · Empresarial
// Bónus 70km, Desvio de Rota, Monitorização Parental — tudo real com Supabase
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EscolarMonitor from './EscolarMonitor';
import { mapService } from '../services/mapService';
import { buildContractPDF, saveFile, shareFile } from '../services/pdfService';
import { Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';


type ContractType = 'school' | 'family' | 'corporate';

interface Contract {
  id: string;
  user_id: string;
  contract_type: ContractType;
  title: string;
  address: string;
  dest_lat: number;
  dest_lng: number;
  time_start: string;
  time_end: string;
  parent_monitoring: boolean;
  km_accumulated: number;
  bonus_kz: number;
  active: boolean;
  created_at: string;
  route_deviation_alert: boolean;
  max_deviation_km: number;
  contact_name?: string;
  contact_phone?: string;
}

interface KmBonus {
  km_total: number;
  free_km_available: number;
  km_to_next_perk: number;
}

const CONTRACT_ICONS: Record<ContractType, string> = {
  school: 'school',
  family: 'family_home',
  corporate: 'business',
};

const CONTRACT_LABELS: Record<ContractType, string> = {
  school: 'Contrato Escolar',
  family: 'Contrato Familiar',
  corporate: 'Contrato Empresarial',
};

const PERK_THRESHOLD = 70;

const Contract: React.FC = () => {
  const { dbUser } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [kmBonus, setKmBonus] = useState<KmBonus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [activeContractType, setActiveContractType] = useState<ContractType>('school');

  // New contract form state
  const [form, setForm] = useState({
    title: '', address: '', time_start: '07:30', time_end: '13:00',
    parent_monitoring: true, route_deviation_alert: true,
    max_deviation_km: 2, contact_name: '', contact_phone: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!dbUser?.id) return;
    setLoading(true);

    const [contractsRes, profileRes] = await Promise.all([
      supabase.from('contracts').select('*').eq('user_id', dbUser.id).eq('active', true).order('created_at', { ascending: false }),
      supabase.from('profiles').select('km_total, free_km_available, km_to_next_perk').eq('user_id', dbUser.id).single(),
    ]);

    if (contractsRes.data) setContracts(contractsRes.data as Contract[]);
    if (profileRes.data) setKmBonus(profileRes.data as KmBonus);
    setLoading(false);
  }, [dbUser?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime: km updates
  useEffect(() => {
    if (!dbUser?.id) return;
    const ch = supabase.channel(`contract-perk:${dbUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${dbUser.id}` },
        (p) => setKmBonus(p.new as KmBonus))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [dbUser?.id]);

  // ── Schedule a ride for a contract ──────────────────────────────────────
  const handleSchedule = async (contract: Contract) => {
    if (!dbUser?.id) return;
    setScheduling(contract.id);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('last_known_lat, last_known_lng')
        .eq('user_id', dbUser.id)
        .single();
  
      const originLat = profileData?.last_known_lat ?? -8.8368;
      const originLng = profileData?.last_known_lng ?? 13.2343;
  
      const { error } = await supabase.from('rides').insert({
        passenger_id:   dbUser.id,
        status:         'searching',
        dest_address:   contract.address,
        dest_lat:       contract.dest_lat,
        dest_lng:       contract.dest_lng,
        origin_address: 'A minha localização',
        origin_lat:     originLat,
        origin_lng:     originLng,
        contract_id:    contract.id,
        scheduled_time: contract.time_start,
      });
  
      if (error) throw new Error('Não foi possível agendar. Verifica a tua ligação.');
      setSuccessId(contract.id);
      setTimeout(() => setSuccessId(null), 4000);
    } catch (err: any) {
      alert(`❌ ${err?.message ?? 'Erro ao agendar corrida. Tenta de novo.'}`);
    } finally {
      setScheduling(null);
    }
  };

  // ── Save new contract ────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser?.id || !form.title || !form.address) { setSaveError('Preenche o nome e a morada.'); return; }
    setSaving(true); setSaveError(null);
    // Geocodificar o endereço de destino
    const coords = await mapService.geocodeAddress(form.address);
    const dest_lat = coords?.lat ?? -8.836;
    const dest_lng = coords?.lng ?? 13.234;

    const { error } = await supabase.from('contracts').insert({
      user_id: dbUser.id,
      contract_type: activeContractType,
      title: form.title, address: form.address,
      dest_lat, dest_lng,
      time_start: form.time_start, time_end: form.time_end,
      parent_monitoring: form.parent_monitoring,
      route_deviation_alert: form.route_deviation_alert,
      max_deviation_km: form.max_deviation_km,
      contact_name: form.contact_name || null,
      contact_phone: form.contact_phone || null,
      active: true, km_accumulated: 0, bonus_kz: 0,
    });
    setSaving(false);
    if (error) { setSaveError('Erro ao guardar. Tenta de novo.'); return; }
    setShowAddForm(false);
    setForm({ title: '', address: '', time_start: '07:30', time_end: '13:00', parent_monitoring: true, route_deviation_alert: true, max_deviation_km: 2, contact_name: '', contact_phone: '' });
    loadData();
  };

  // ── Deactivate contract ──────────────────────────────────────────────────
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const handleDeactivate  = (id: string) => setDeactivatingId(id);
  const confirmDeactivate = async () => {
    if (!deactivatingId) return;
    await supabase.from('contracts').update({ active: false }).eq('id', deactivatingId);
    setContracts(prev => prev.filter(c => c.id !== deactivatingId));
    setDeactivatingId(null);
  };

  // ── KM Bonus bar ─────────────────────────────────────────────────────────
  const progressPct = kmBonus
    ? Math.min(((PERK_THRESHOLD - kmBonus.km_to_next_perk) / PERK_THRESHOLD) * 100, 100)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-10 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end px-2">
        <div>
          <h2 className="font-headline text-3xl italic font-bold tracking-tighter">
            Contratos
          </h2>
          <p className="text-[9px] text-on-surface-variant font-label uppercase tracking-[0.3em]">
            MFUMU Edition · Rotas Fixas
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[9px] font-label font-bold uppercase tracking-widest text-primary">ATIVO</span>
        </div>
      </div>

      {/* 70km Perk banner */}
      {kmBonus && (
        <div className="rounded-xl border border-primary/20 p-4 space-y-2"
          style={{ background: 'rgba(230,195,100,0.05)' }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">emoji_events</span>
              <p className="font-label text-[10px] uppercase tracking-widest text-primary font-bold">
                Bónus Fidelidade — 70 km
              </p>
            </div>
            {kmBonus.free_km_available > 0 && (
              <span className="font-label text-[9px] font-bold text-primary bg-primary/15 px-3 py-1 rounded-full">
                🎁 {kmBonus.free_km_available.toFixed(0)} km GRÁTIS
              </span>
            )}
          </div>
          <div className="h-2 bg-surface-container-low rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${progressPct}%`, boxShadow: '0 0 8px rgba(230,195,100,0.5)' }} />
          </div>
          <div className="flex justify-between text-[9px] font-label text-on-surface-variant">
            <span>{Math.round(kmBonus.km_total % PERK_THRESHOLD)} km percorridos</span>
            <span>Faltam {Math.ceil(kmBonus.km_to_next_perk)} km → 5 km grátis</span>
          </div>
        </div>
      )}

      {/* Active contracts */}
      {contracts.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <span className="material-symbols-outlined text-primary/30 text-5xl">description</span>
          <p className="font-label text-on-surface-variant text-sm">Nenhum contrato activo.</p>
          <p className="font-label text-on-surface-variant/50 text-xs">Cria um contrato escolar, familiar ou empresarial.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {contracts.map(c => (
            <ContractCard
              key={c.id}
              contract={c}
              isScheduling={scheduling === c.id}
              isSuccess={successId === c.id}
              onSchedule={() => handleSchedule(c)}
              onDeactivate={() => handleDeactivate(c.id)}
            />
          ))}
        </div>
      )}

      {/* Add form */}
      {showAddForm ? (
        <div className="rounded-2xl border border-primary/25 p-6 space-y-5"
          style={{ background: 'rgba(14,14,14,0.95)' }}>
          {/* Type selector */}
          <div>
            <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-3">Tipo de Contrato</p>
            <div className="grid grid-cols-3 gap-2">
              {(['school', 'family', 'corporate'] as ContractType[]).map(t => (
                <button key={t} onClick={() => setActiveContractType(t)}
                  className="py-3 rounded-lg font-label text-[9px] uppercase tracking-wider font-bold transition-all"
                  style={{
                    border: `1px solid ${activeContractType === t ? '#E6C364' : 'rgba(230,195,100,0.15)'}`,
                    background: activeContractType === t ? 'rgba(230,195,100,0.12)' : 'transparent',
                    color: activeContractType === t ? '#E6C364' : 'rgba(230,195,100,0.4)',
                  }}>
                  <span className="material-symbols-outlined text-sm block mb-1">{CONTRACT_ICONS[t]}</span>
                  {t === 'school' ? 'Escola' : t === 'family' ? 'Família' : 'Empresa'}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <ZField label={activeContractType === 'school' ? 'Nome da Escola' : activeContractType === 'family' ? 'Nome da Família' : 'Nome da Empresa'}
              value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} placeholder="ex: Creche Estrelinhas" />
            <ZField label="Morada de Destino" value={form.address}
              onChange={v => setForm(p => ({ ...p, address: v }))} placeholder="Rua, Bairro, Luanda" />

            {(activeContractType === 'school' || activeContractType === 'family') && (
              <ZField label="Nome do Responsável" value={form.contact_name}
                onChange={v => setForm(p => ({ ...p, contact_name: v }))} placeholder="Nome do pai/mãe/tutor" />
            )}
            {(activeContractType === 'school' || activeContractType === 'family') && (
              <ZField label="Telemóvel (+244)" value={form.contact_phone}
                onChange={v => setForm(p => ({ ...p, contact_phone: v }))} placeholder="9XX XXX XXX" />
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant mb-1.5">Hora Ida</p>
                <input type="time" value={form.time_start}
                  onChange={e => setForm(p => ({ ...p, time_start: e.target.value }))}
                  className="w-full rounded-lg p-3 font-label text-sm outline-none"
                  style={{ background: 'rgba(230,195,100,0.06)', border: '1px solid rgba(230,195,100,0.2)', color: '#E6C364' }} />
              </div>
              <div>
                <p className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant mb-1.5">Hora Volta</p>
                <input type="time" value={form.time_end}
                  onChange={e => setForm(p => ({ ...p, time_end: e.target.value }))}
                  className="w-full rounded-lg p-3 font-label text-sm outline-none"
                  style={{ background: 'rgba(230,195,100,0.06)', border: '1px solid rgba(230,195,100,0.2)', color: '#E6C364' }} />
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-3">
              <Toggle label="Monitorização Parental em Tempo Real" value={form.parent_monitoring}
                onChange={v => setForm(p => ({ ...p, parent_monitoring: v }))} />
              <Toggle label="Alerta de Desvio de Rota" value={form.route_deviation_alert}
                onChange={v => setForm(p => ({ ...p, route_deviation_alert: v }))} />
              {form.route_deviation_alert && (
                <div className="pl-4">
                  <p className="font-label text-[9px] text-on-surface-variant mb-1">Tolerância de desvio: {form.max_deviation_km} km</p>
                  <input type="range" min={1} max={5} value={form.max_deviation_km}
                    onChange={e => setForm(p => ({ ...p, max_deviation_km: +e.target.value }))}
                    className="w-full accent-yellow-400" />
                </div>
              )}
            </div>

            {saveError && (
              <p className="font-label text-xs text-error text-center">{saveError}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowAddForm(false)}
                className="flex-1 py-4 rounded-lg font-label text-[10px] uppercase tracking-widest font-bold transition-all"
                style={{ border: '1px solid rgba(230,195,100,0.2)', color: 'rgba(230,195,100,0.5)' }}>
                Cancelar
              </button>
              <button type="submit" disabled={saving}
                className="flex-[2] py-4 rounded-lg font-label text-[10px] uppercase tracking-widest font-extrabold transition-all active:scale-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #C9A84C, #E6C364)', color: '#0B0B0B' }}>
                {saving ? 'A guardar...' : 'CRIAR CONTRATO'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button onClick={() => setShowAddForm(true)}
          className="w-full py-8 rounded-2xl font-label text-[10px] uppercase tracking-[0.25em] font-bold transition-all hover:bg-primary/8 active:scale-95"
          style={{ border: '2px dashed rgba(230,195,100,0.25)', color: 'rgba(230,195,100,0.5)' }}>
          <span className="material-symbols-outlined block mb-1 text-2xl">add_circle</span>
          Adicionar Novo Contrato
        </button>
      )}

      {deactivatingId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm space-y-4"
               style={{ background: '#0E0E0E', border: '1px solid rgba(230,195,100,0.2)' }}>
            <div className="text-center">
              <span className="material-symbols-outlined text-4xl text-primary mb-3 block">warning</span>
              <h3 className="font-headline text-lg italic font-bold text-on-surface">Desactivar Contrato?</h3>
              <p className="text-[11px] text-on-surface-variant/70 mt-2 font-label">
                Esta acção não pode ser desfeita.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeactivatingId(null)}
                className="flex-1 py-3 rounded-xl font-label text-[10px] uppercase tracking-widest font-bold"
                style={{ border: '1px solid rgba(230,195,100,0.2)', color: 'rgba(230,195,100,0.5)' }}>
                Cancelar
              </button>
              <button onClick={confirmDeactivate}
                className="flex-1 py-3 rounded-xl font-label text-[10px] uppercase tracking-widest font-extrabold"
                style={{ background: '#dc2626', color: 'white' }}>
                Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Contract Card ────────────────────────────────────────────────────────────
const ContractCard: React.FC<{
  contract: Contract;
  isScheduling: boolean;
  isSuccess: boolean;
  onSchedule: () => void;
  onDeactivate: () => void;
}> = ({ contract: c, isScheduling, isSuccess, onSchedule, onDeactivate }) => {
  const [showMonitor, setShowMonitor] = useState(false);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [sharingLink, setSharingLink] = useState(false);

  const generateTrackingLink = async () => {
    setSharingLink(true);
    try {
      const { data, error } = await supabase
        .from('school_tracking_sessions')
        .insert({
          contract_id: c.id,
          expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        })
        .select('public_token')
        .single();

      if (error || !data) {
        alert('Erro ao gerar link. Tenta novamente.');
        return;
      }

      const link = `${window.location.origin}/track/${data.public_token}`;
      setTrackingToken(data.public_token);

      const msg = encodeURIComponent(
        `🚗 *Zenith Ride — Rastreio em tempo real*\n\nPodes acompanhar a localização em tempo real aqui:\n${link}\n\n_O link expira em 8 horas._`
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    } finally {
      setSharingLink(false);
    }
  };

  const generateContractPDF = async (mode: 'save' | 'share') => {
    try {
      const base64 = await buildContractPDF(c as any);
      const fileName = `zenith_contrato_${c.id.substring(0, 8)}.pdf`;

      if (mode === 'share') {
        if (Capacitor.isNativePlatform()) {
          const uri = await saveFile(base64, fileName, Directory.Cache);
          await shareFile(uri, fileName, { title: 'Contrato Zenith Ride', dialogTitle: 'Partilhar contrato' });
        } else {
          await shareFile(base64, fileName, { title: 'Contrato Zenith Ride' });
        }
      } else {
        await saveFile(base64, fileName, Directory.Documents);
      }
    } catch (err) {
      console.error('[Contract.generateContractPDF]', err);
      alert('Erro ao gerar/partilhar o PDF.');
    }
  };

  return (
    <div className="rounded-2xl border border-primary/20 overflow-hidden relative"
      style={{ background: '#0E0E0E' }}>
      {/* Success overlay */}
      {isSuccess && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center text-center p-6 animate-in zoom-in duration-300"
          style={{ background: 'rgba(230,195,100,0.97)' }}>
          <span className="material-symbols-outlined text-5xl text-on-primary mb-3" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <h4 className="font-headline text-xl italic font-bold text-on-primary">Corrida Agendada!</h4>
          <p className="font-label text-[10px] uppercase tracking-widest text-on-primary/70 mt-2">
            Motorista chega às {c.time_start}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="p-6 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(230,195,100,0.12)', border: '1px solid rgba(230,195,100,0.2)' }}>
              <span className="material-symbols-outlined text-primary">{CONTRACT_ICONS[c.contract_type]}</span>
            </div>
            <div>
              <p className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant">
                {CONTRACT_LABELS[c.contract_type]}
              </p>
              <h3 className="font-headline text-lg italic font-bold text-on-surface">{c.title}</h3>
            </div>
          </div>
          <button onClick={onDeactivate} className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant/30 hover:text-error transition-colors">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <p className="font-label text-[10px] text-primary pl-13 pl-[3.25rem]">📍 {c.address}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-px bg-outline-variant/10 mx-6 mb-5 rounded-xl overflow-hidden">
        <StatCell icon="schedule" label="Hora" value={`${c.time_start} – ${c.time_end}`} />
        <StatCell icon="route" label="Km Acum." value={`${c.km_accumulated} km`} />
        <StatCell icon="payments" label="Bónus" value={`${c.bonus_kz.toLocaleString()} Kz`} gold />
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 px-6 mb-5">
        {c.parent_monitoring && (
          <Badge icon="shield" label="Monitorização Parental" />
        )}
        {c.route_deviation_alert && (
          <Badge icon="alt_route" label={`Alerta Desvio > ${c.max_deviation_km}km`} />
        )}
        {c.contact_name && (
          <Badge icon="person" label={c.contact_name} />
        )}
      </div>

      {/* EscolarMonitor (school & family only) */}
      {c.parent_monitoring && (
        <div className="px-6 mb-4 space-y-3">
          <button onClick={() => setShowMonitor(!showMonitor)}
            className="w-full flex items-center justify-between py-3 px-4 rounded-xl font-label text-[10px] uppercase tracking-widest font-bold transition-all"
            style={{ border: '1px solid rgba(230,195,100,0.2)', color: 'rgba(230,195,100,0.7)', background: showMonitor ? 'rgba(230,195,100,0.08)' : 'transparent' }}>
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">location_on</span>
              Ver Monitorização
            </span>
            <span className="material-symbols-outlined text-sm">{showMonitor ? 'expand_less' : 'expand_more'}</span>
          </button>
          
          <button
            onClick={generateTrackingLink}
            disabled={sharingLink}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-label text-[10px] uppercase tracking-widest font-bold transition-all active:scale-95 disabled:opacity-50"
            style={{ background: '#25D366', color: '#FFF' }}>
            <span className="material-symbols-outlined text-sm">share</span>
            {sharingLink ? 'A gerar...' : '📍 Partilhar Rastreio via WhatsApp'}
          </button>

          {showMonitor && (
            <div className="mt-3 animate-in fade-in duration-200">
              <EscolarMonitor contractId={c.id} contractTitle={c.title} />
            </div>
          )}
        </div>
      )}

      {/* PDF Buttons */}
      <div className="flex gap-3 px-6 mb-4 mt-2">
        <button
          onClick={() => generateContractPDF('share')}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white rounded-xl font-black text-[10px] uppercase active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">share</span>
          📤 Partilhar PDF
        </button>
        <button
          onClick={() => generateContractPDF('save')}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 border border-white/10 text-white/80 rounded-xl font-black text-[10px] uppercase active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">save</span>
          💾 Guardar
        </button>
      </div>

      {/* Schedule button */}
      <div className="px-6 pb-6">
        <button onClick={onSchedule} disabled={isScheduling}
          className="w-full py-5 rounded-xl font-label font-extrabold text-[10px] uppercase tracking-[0.2em] transition-all active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #C9A84C, #E6C364)', color: '#0B0B0B', boxShadow: '0 8px 20px rgba(201,168,76,0.25)' }}>
          {isScheduling ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-[#0B0B0B]/30 border-t-[#0B0B0B] rounded-full animate-spin" />
              A sincronizar IA...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-sm">bolt</span>
              AGENDAR CORRIDA
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const StatCell: React.FC<{ icon: string; label: string; value: string; gold?: boolean }> = ({ icon, label, value, gold }) => (
  <div className="flex flex-col items-center py-4 gap-1" style={{ background: 'rgba(230,195,100,0.03)' }}>
    <span className="material-symbols-outlined text-primary/50 text-sm">{icon}</span>
    <p className="font-label text-[8px] uppercase tracking-widest text-on-surface-variant">{label}</p>
    <p className={`font-headline text-sm font-bold italic ${gold ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
  </div>
);

const Badge: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
    style={{ border: '1px solid rgba(230,195,100,0.2)', background: 'rgba(230,195,100,0.06)' }}>
    <span className="material-symbols-outlined text-primary text-xs">{icon}</span>
    <span className="font-label text-[9px] text-primary/70 font-semibold">{label}</span>
  </div>
);

const ZField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({ label, value, onChange, placeholder }) => (
  <div className="space-y-1.5">
    <p className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant">{label}</p>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg px-4 py-3 font-label text-sm outline-none transition-all"
      style={{ background: 'rgba(230,195,100,0.06)', border: '1px solid rgba(230,195,100,0.2)', color: '#E6C364' }} />
  </div>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between py-2">
    <p className="font-label text-[10px] text-on-surface-variant">{label}</p>
    <button onClick={() => onChange(!value)}
      className="w-12 h-6 rounded-full relative transition-all duration-300"
      style={{ background: value ? '#E6C364' : 'rgba(230,195,100,0.15)' }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-300 shadow-md"
        style={{ left: value ? '1.5rem' : '0.125rem', background: value ? '#0B0B0B' : 'rgba(230,195,100,0.5)' }} />
    </button>
  </div>
);

export default Contract;
