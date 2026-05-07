// =============================================================================
// ZENITH RIDE — Contract.tsx — MFUMU ZENITH EDITION
// Contratos IA: Escolar · Familiar · Empresarial
// Bónus 70km, Desvio de Rota, Monitorização Parental — tudo real com Supabase
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore } from '../store/useAppStore';
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
  // Premium fields
  monthly_credit_kz?: number;
  credit_remaining_kz?: number;
  discount_pct?: number;
  payment_status?: 'active' | 'expired' | 'pending';
}

interface KmBonus {
  km_total: number;
  free_km_available: number;
  km_to_next_perk: number;
  has_pass?: boolean;
  pass_rides_remaining?: number;
  pass_expires_at?: string;
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
  const showToast = useAppStore((s) => s.showToast);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [kmBonus, setKmBonus] = useState<KmBonus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [activeContractType, setActiveContractType] = useState<ContractType>('school');
  const [activeTab, setActiveTab] = useState<'contracts' | 'pass'>('contracts');

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
      supabase.from('contracts').select('*, monthly_credit_kz, credit_remaining_kz, discount_pct, payment_status').eq('user_id', dbUser.id).eq('active', true).order('created_at', { ascending: false }),
      supabase.from('profiles').select('km_total, free_km_available, km_to_next_perk, has_pass, pass_rides_remaining, pass_expires_at').eq('user_id', dbUser.id).single(),
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
        passenger_id: dbUser.id,
        status: 'searching',
        dest_address: contract.address,
        dest_lat: contract.dest_lat,
        dest_lng: contract.dest_lng,
        origin_address: 'A minha localização',
        origin_lat: originLat,
        origin_lng: originLng,
        contract_id: contract.id,
        scheduled_time: contract.time_start,
      });

      if (error) throw new Error('Não foi possível agendar. Verifica a tua ligação.');
      setSuccessId(contract.id);
      setTimeout(() => setSuccessId(null), 4000);
    } catch (err: any) {
      showToast(`❌ ${err?.message ?? 'Erro ao agendar corrida. Tenta de novo.'}`, 'error');
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
  const handleDeactivate = (id: string) => setDeactivatingId(id);
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
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingTop: '80px', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">MFUMU Edition · Rotas Fixas</p>
            <h2 className="zr-section-title">Contratos & Pass</h2>
          </div>
          <span className="zr-chip zr-chip--gold">ATIVO</span>
        </div>
        {/* Tab bar */}
        <div className="zr-inline" style={{ gap: 8, marginTop: 12 }}>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`zr-chip ${activeTab === 'contracts' ? 'zr-chip--gold' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            📋 Contratos
          </button>
          <button
            onClick={() => setActiveTab('pass')}
            className={`zr-chip ${activeTab === 'pass' ? 'zr-chip--gold' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            🎫 Zenith Pass
          </button>
        </div>
      </header>
      <div style={{ padding: '14px' }}>

        {/* Zenith Pass Tab */}
        {activeTab === 'pass' && (
          <ZenithPassSection kmBonus={kmBonus} userId={dbUser?.id ?? ''} showToast={showToast} onRefresh={loadData} />
        )}

        {activeTab === 'contracts' && (
          <>
            {/* 70km Perk banner */}
            {kmBonus && (
              <div className="zr-alert-box zr-alert-box--success" style={{ marginBottom: '24px' }}>
                <div className="zr-inline zr-inline--between" style={{ marginBottom: '8px' }}>
                  <div className="zr-inline" style={{ gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--gold)' }}>emoji_events</span>
                    <strong style={{ color: 'var(--gold)' }}>Bónus Fidelidade — 70 km</strong>
                  </div>
                  {kmBonus.free_km_available > 0 && (
                    <span className="zr-chip zr-chip--gold">🎁 {kmBonus.free_km_available.toFixed(0)} km GRÁTIS</span>
                  )}
                </div>
                <div className="zr-progress" style={{ margin: '12px 0' }}>
                  <div className="zr-progress-bar" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="zr-inline zr-inline--between" style={{ fontSize: '10px' }}>
                  <span className="zr-meta">{Math.round(kmBonus.km_total % PERK_THRESHOLD)} km percorridos</span>
                  <span className="zr-meta" style={{ color: 'var(--gold-soft)' }}>Faltam {Math.ceil(kmBonus.km_to_next_perk)} km → 5 km grátis</span>
                </div>
              </div>
            )}

            {/* Active contracts */}
            {contracts.length === 0 ? (
              <div className="zr-empty" style={{ marginBottom: '24px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '16px' }}>description</span>
                <p className="zr-copy">Nenhum contrato activo.</p>
                <p className="zr-meta">Cria um contrato escolar, familiar ou empresarial.</p>
              </div>
            ) : (
              <div className="zr-stack" style={{ gap: '24px', marginBottom: '24px' }}>
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
              <div className="zr-card" style={{ marginBottom: '24px' }}>
                <div>
                  <p className="zr-label" style={{ marginBottom: '8px' }}>Tipo de Contrato</p>
                  <div className="zr-inline" style={{ marginBottom: '16px', gap: '8px' }}>
                    {(['school', 'family', 'corporate'] as ContractType[]).map(t => (
                      <button key={t} onClick={() => setActiveContractType(t)}
                        className={`zr-chip ${activeContractType === t ? 'zr-chip--gold' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>{CONTRACT_ICONS[t]}</span>
                        {t === 'school' ? 'Escola' : t === 'family' ? 'Família' : 'Empresa'}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSave} className="zr-stack" style={{ gap: '16px' }}>
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

                  <div className="zr-inline" style={{ gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <p className="zr-label">Hora Ida</p>
                      <input type="time" value={form.time_start}
                        onChange={e => setForm(p => ({ ...p, time_start: e.target.value }))}
                        className="zr-input" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p className="zr-label">Hora Volta</p>
                      <input type="time" value={form.time_end}
                        onChange={e => setForm(p => ({ ...p, time_end: e.target.value }))}
                        className="zr-input" />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="zr-stack" style={{ gap: '8px' }}>
                    <Toggle label="Monitorização Parental em Tempo Real" value={form.parent_monitoring}
                      onChange={v => setForm(p => ({ ...p, parent_monitoring: v }))} />
                    <Toggle label="Alerta de Desvio de Rota" value={form.route_deviation_alert}
                      onChange={v => setForm(p => ({ ...p, route_deviation_alert: v }))} />
                    {form.route_deviation_alert && (
                      <div style={{ paddingLeft: '16px' }}>
                        <p className="zr-meta" style={{ marginBottom: '8px' }}>Tolerância de desvio: {form.max_deviation_km} km</p>
                        <input type="range" min={1} max={5} value={form.max_deviation_km}
                          onChange={e => setForm(p => ({ ...p, max_deviation_km: +e.target.value }))}
                          style={{ width: '100%', accentColor: 'var(--gold)' }} />
                      </div>
                    )}
                  </div>

                  {saveError && (
                    <p className="zr-meta" style={{ color: 'var(--danger)', textAlign: 'center' }}>{saveError}</p>
                  )}

                  <div className="zr-inline" style={{ gap: '8px', marginTop: '8px' }}>
                    <button type="button" onClick={() => setShowAddForm(false)} className="zr-button zr-button--secondary" style={{ flex: 1 }}>
                      Cancelar
                    </button>
                    <button type="submit" disabled={saving} className="zr-button" style={{ flex: 2 }}>
                      {saving ? 'A guardar...' : 'Criar Contrato'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <button onClick={() => setShowAddForm(true)} className="zr-button zr-button--secondary zr-button--block" style={{ borderStyle: 'dashed' }}>
                <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>add_circle</span>
                Adicionar Novo Contrato
              </button>
            )}

            {deactivatingId && (
              <div className="zr-modal is-open">
                <div className="zr-modal-card">
                  <div className="zr-modal-head" style={{ justifyContent: 'center', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--danger-soft)' }}>warning</span>
                    <h3 className="zr-section-title">Desactivar Contrato?</h3>
                    <p className="zr-meta">Esta acção não pode ser desfeita.</p>
                  </div>
                  <div style={{ padding: '20px' }}>
                    <div className="zr-inline" style={{ gap: '8px' }}>
                      <button onClick={() => setDeactivatingId(null)} className="zr-button zr-button--secondary" style={{ flex: 1 }}>Cancelar</button>
                      <button onClick={confirmDeactivate} className="zr-button zr-button--danger" style={{ flex: 1 }}>Desactivar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
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
  const showToast = useAppStore((s) => s.showToast);
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
        showToast('Erro ao gerar link. Tenta novamente.', 'error');
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
      showToast('Erro ao gerar/partilhar o PDF.', 'error');
    }
  };

  return (
    <div className="zr-card" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Success overlay */}
      {isSuccess && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--gold)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#000', marginBottom: '12px' }}>check_circle</span>
          <h4 className="zr-section-title" style={{ color: '#000' }}>Corrida Agendada!</h4>
          <p className="zr-meta" style={{ color: 'rgba(0,0,0,0.7)' }}>
            Motorista chega às {c.time_start}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="zr-inline zr-inline--between" style={{ alignItems: 'flex-start', marginBottom: '16px' }}>
        <div className="zr-inline" style={{ gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
            <span className="material-symbols-outlined">{CONTRACT_ICONS[c.contract_type]}</span>
          </div>
          <div>
            <p className="zr-kicker" style={{ margin: 0 }}>{CONTRACT_LABELS[c.contract_type]}</p>
            <h3 className="zr-section-title" style={{ fontSize: '18px', margin: 0 }}>{c.title}</h3>
            <p className="zr-meta" style={{ color: 'var(--gold)', marginTop: '4px' }}>📍 {c.address}</p>
          </div>
        </div>
        <button onClick={onDeactivate} className="zr-icon-button" style={{ color: 'var(--danger-soft)' }}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Premium credit banner */}
      {(c.monthly_credit_kz ?? 0) > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(230,195,100,0.12), rgba(230,195,100,0.04))',
          border: '1px solid rgba(230,195,100,0.2)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Saldo do Contrato</span>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#ffaa00', fontFamily: 'var(--font-heading)', fontStyle: 'italic' }}>
              {(c.credit_remaining_kz ?? 0).toLocaleString()} Kz
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`zr-chip ${c.payment_status === 'active' ? 'zr-chip--gold' : c.payment_status === 'expired' ? 'zr-chip--danger' : 'zr-chip--muted'}`}>
              {c.payment_status === 'active' ? '✅ Pago' : c.payment_status === 'expired' ? '❌ Expirado' : '⏳ Pendente'}
            </span>
            <p style={{ margin: '4px 0 0', fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
              -{c.discount_pct ?? 25}% desconto
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="zr-kpi-grid" style={{ marginBottom: '20px' }}>
        <StatCell icon="schedule" label="Hora" value={`${c.time_start} – ${c.time_end}`} />
        <StatCell icon="route" label="Km Acum." value={`${c.km_accumulated} km`} />
        <StatCell icon="payments" label="Bónus" value={`${c.bonus_kz.toLocaleString()} Kz`} gold />
      </div>

      {/* Badges */}
      <div className="zr-inline" style={{ flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        {c.parent_monitoring && <Badge icon="shield" label="Monitorização Parental" />}
        {c.route_deviation_alert && <Badge icon="alt_route" label={`Alerta Desvio > ${c.max_deviation_km}km`} />}
        {c.contact_name && <Badge icon="person" label={c.contact_name} />}
        {(c.monthly_credit_kz ?? 0) > 0 && <Badge icon="credit_card" label="Assinatura Premium" />}
      </div>

      {/* EscolarMonitor */}
      {c.parent_monitoring && (
        <div className="zr-stack" style={{ gap: '12px', marginBottom: '16px' }}>
          <button onClick={() => setShowMonitor(!showMonitor)} className="zr-button zr-button--secondary zr-button--block">
            <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>location_on</span>
            Ver Monitorização
            <span className="material-symbols-outlined" style={{ marginLeft: 'auto' }}>{showMonitor ? 'expand_less' : 'expand_more'}</span>
          </button>

          <button onClick={generateTrackingLink} disabled={sharingLink} className="zr-button zr-button--block" style={{ backgroundColor: '#25D366', color: '#fff' }}>
            <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>share</span>
            {sharingLink ? 'A gerar...' : '📍 Partilhar Rastreio via WhatsApp'}
          </button>

          {showMonitor && (
            <div style={{ marginTop: '12px' }}>
              <EscolarMonitor contractId={c.id} contractTitle={c.title} />
            </div>
          )}
        </div>
      )}

      {/* PDF Buttons */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <button onClick={() => generateContractPDF('share')} className="zr-button zr-button--block" style={{ flex: 1, backgroundColor: '#25D366', color: '#fff' }}>
          <span className="material-symbols-outlined" style={{ marginRight: '4px', fontSize: '16px' }}>share</span> Partilhar PDF
        </button>
        <button onClick={() => generateContractPDF('save')} className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1 }}>
          <span className="material-symbols-outlined" style={{ marginRight: '4px', fontSize: '16px' }}>save</span> Guardar
        </button>
      </div>

      {/* Schedule button */}
      <button onClick={onSchedule} disabled={isScheduling} className="zr-button zr-button--block">
        {isScheduling ? 'A sincronizar IA...' : 'Agendar Corrida'}
      </button>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const StatCell: React.FC<{ icon: string; label: string; value: string; gold?: boolean }> = ({ icon, label, value, gold }) => (
  <div style={{ padding: '12px', textAlign: 'center' }}>
    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--muted)', marginBottom: '4px' }}>{icon}</span>
    <p className="zr-meta" style={{ fontSize: '9px', marginBottom: '4px' }}>{label}</p>
    <p style={{ fontFamily: 'var(--font-heading)', fontSize: '14px', fontWeight: 'bold', fontStyle: 'italic', color: gold ? 'var(--gold)' : 'var(--text)' }}>{value}</p>
  </div>
);

const Badge: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="zr-chip zr-chip--gold">
    <span className="material-symbols-outlined" style={{ fontSize: '12px', marginRight: '4px' }}>{icon}</span>
    {label}
  </div>
);

const ZField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({ label, value, onChange, placeholder }) => (
  <div>
    <label className="zr-label">{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="zr-input" />
  </div>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="zr-inline zr-inline--between" style={{ padding: '8px 0' }}>
    <span className="zr-meta">{label}</span>
    <button onClick={() => onChange(!value)} style={{ width: '40px', height: '24px', borderRadius: '12px', background: value ? 'var(--gold)' : 'var(--surface-3)', position: 'relative', border: 'none', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: '2px', left: value ? '18px' : '2px', width: '20px', height: '20px', borderRadius: '10px', background: value ? '#000' : 'var(--gold-soft)', transition: 'left 0.2s' }} />
    </button>
  </div>
);
// ─── Zenith Pass Section ──────────────────────────────────────────────────────
const PASS_RIDES = 10;
const PASS_DISCOUNT = 0.80; // 80% do preço = 20% desconto
const AVERAGE_RIDE_KZ = 3000;

const ZenithPassSection: React.FC<{
  kmBonus: KmBonus | null;
  userId: string;
  showToast: (msg: string, type: 'success' | 'error') => void;
  onRefresh: () => void;
}> = ({ kmBonus, userId, showToast, onRefresh }) => {
  const [buying, setBuying] = useState(false);
  const passActive = kmBonus?.has_pass && (kmBonus?.pass_rides_remaining ?? 0) > 0;
  const passExpired = kmBonus?.has_pass && (kmBonus?.pass_rides_remaining ?? 0) === 0;
  const totalPrice = PASS_RIDES * AVERAGE_RIDE_KZ;
  const passPrice = Math.round(totalPrice * PASS_DISCOUNT);
  const savings = totalPrice - passPrice;

  const handleBuyPass = async () => {
    setBuying(true);
    try {
      // Verificar saldo
      const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', userId).single();
      if (!wallet || wallet.balance < passPrice) {
        showToast(`Saldo insuficiente. Precisas de ${passPrice.toLocaleString()} Kz.`, 'error');
        return;
      }
      // Debitar e activar pass
      const { error: walletErr } = await supabase.rpc('process_withdrawal', { p_user_id: userId, p_amount: passPrice });
      if (walletErr) throw walletErr;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      await supabase.from('profiles').update({
        has_pass: true,
        pass_rides_remaining: PASS_RIDES,
        pass_expires_at: expiresAt.toISOString(),
      }).eq('user_id', userId);

      showToast(`🎫 Zenith Pass activado! ${PASS_RIDES} corridas disponíveis.`, 'success');
      onRefresh();
    } catch {
      showToast('Erro ao comprar Pass. Tenta de novo.', 'error');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Pass Status */}
      {passActive && (
        <div className="zr-alert-box zr-alert-box--success" style={{ marginBottom: 16 }}>
          <div className="zr-inline zr-inline--between">
            <div className="zr-inline" style={{ gap: 8 }}>
              <span style={{ fontSize: 24 }}>🎫</span>
              <div>
                <strong style={{ color: 'var(--gold)' }}>Zenith Pass Activo</strong>
                <p className="zr-meta" style={{ margin: 0 }}>
                  {kmBonus?.pass_rides_remaining} corridas restantes · Desconto 20%
                </p>
              </div>
            </div>
            <span className="zr-chip zr-chip--gold">{kmBonus?.pass_rides_remaining}/{PASS_RIDES}</span>
          </div>
        </div>
      )}

      {passExpired && (
        <div className="zr-alert-box zr-alert-box--warning" style={{ marginBottom: 16 }}>
          <span className="material-symbols-outlined">info</span>
          <div className="zr-alert-content">
            <strong>Pass expirado</strong>
            <p>As tuas {PASS_RIDES} corridas foram usadas. Renova para continuar a poupar.</p>
          </div>
        </div>
      )}

      {/* Buy Card */}
      <div className="zr-card" style={{ background: 'linear-gradient(135deg, rgba(230,195,100,0.08), rgba(230,195,100,0.02))' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 48 }}>🎫</span>
          <h3 className="zr-section-title" style={{ margin: '8px 0 4px' }}>Zenith Pass</h3>
          <p className="zr-meta">Pacote de {PASS_RIDES} corridas com desconto de 20%</p>
        </div>

        <div className="zr-kpi-grid" style={{ marginBottom: 16 }}>
          <StatCell icon="confirmation_number" label="Corridas" value={`${PASS_RIDES}`} />
          <StatCell icon="savings" label="Poupança" value={`${savings.toLocaleString()} Kz`} gold />
          <StatCell icon="payments" label="Preço" value={`${passPrice.toLocaleString()} Kz`} gold />
        </div>

        <div className="zr-card" style={{ padding: 12, background: 'rgba(0,0,0,0.2)', marginBottom: 16 }}>
          <p className="zr-meta" style={{ margin: 0, textAlign: 'center' }}>
            Preço normal: <span style={{ textDecoration: 'line-through' }}>{totalPrice.toLocaleString()} Kz</span>
            → <strong style={{ color: 'var(--gold)' }}>{passPrice.toLocaleString()} Kz</strong>
          </p>
        </div>

        <button
          onClick={handleBuyPass}
          disabled={buying || passActive}
          className="zr-button zr-button--block"
          style={{ fontSize: 14 }}
        >
          {buying ? 'A processar...' : passActive ? '✅ Pass Activo' : `Comprar Zenith Pass — ${passPrice.toLocaleString()} Kz`}
        </button>
      </div>
    </div>
  );
};

export default Contract;
