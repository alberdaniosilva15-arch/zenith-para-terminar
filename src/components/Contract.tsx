// =============================================================================
// ZENITH RIDE — Contract.tsx — MFUMU ZENITH EDITION
// Contratos IA: Escolar · Familiar · Empresarial
// Bónus 70km, Desvio de Rota, Monitorização Parental — tudo real com Supabase
//
// REFACTOR v3.3 (SRP): o componente deixou de conter toda a UI inline.
// Orquestra apenas dados, navegação por tabs e delegação de eventos para:
//   • contract/ContractUi.tsx        — tipos + átomos (StatCell, Badge, ZField…)
//   • contract/ContractCard.tsx      — card individual do contrato
//   • contract/ZenithPassSection.tsx — pacote de corridas com desconto
//   • contract/AddContractForm.tsx   — formulário de criação
// A API pública (default export <Contract />) permanece inalterada.
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore } from '../store/useAppStore';
import { mapService } from '../services/mapService';
import ContractCard from './contract/ContractCard';
import ZenithPassSection from './contract/ZenithPassSection';
import AddContractForm from './contract/AddContractForm';
import { PERK_THRESHOLD, EMPTY_CONTRACT_FORM } from './contract/ContractUi';
import type { Contract as ContractRecord, ContractType, KmBonus, ContractFormState } from './contract/ContractUi';

const Contract: React.FC = () => {
  const { dbUser } = useAuth();
  const showToast = useAppStore((s) => s.showToast);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [kmBonus, setKmBonus] = useState<KmBonus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [activeContractType, setActiveContractType] = useState<ContractType>('school');
  const [activeTab, setActiveTab] = useState<'contracts' | 'pass'>('contracts');

  // New contract form state
  const [form, setForm] = useState<ContractFormState>(EMPTY_CONTRACT_FORM);
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

    if (contractsRes.data) setContracts(contractsRes.data as ContractRecord[]);
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
  const handleSchedule = async (contract: ContractRecord) => {
    if (!dbUser?.id) return;
    setScheduling(contract.id);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('last_known_lat, last_known_lng')
        .eq('user_id', dbUser.id)
        .single();

      const originAddr = contract.origin_address || 'Ponto de recolha do contrato';
      const destAddr = contract.dest_address || contract.address;

      if (!contract.dest_lat || !contract.dest_lng) {
        showToast('Este contrato não tem coordenadas de destino válidas. Actualiza o contrato.', 'info');
        return;
      }

      const originLat = contract.origin_lat ?? profileData?.last_known_lat ?? -8.8368;
      const originLng = contract.origin_lng ?? profileData?.last_known_lng ?? 13.2343;

      const { error } = await supabase.from('rides').insert({
        passenger_id: dbUser.id,
        status: 'searching',
        dest_address: destAddr,
        dest_lat: contract.dest_lat,
        dest_lng: contract.dest_lng,
        origin_address: originAddr,
        origin_lat: originLat,
        origin_lng: originLng,
        contract_id: contract.id,
        scheduled_time: contract.time_start,
      });

      if (error) throw new Error('Não foi possível agendar. Verifica a tua ligação.');
      setSuccessId(contract.id);
      setTimeout(() => setSuccessId(null), 4000);
    } catch (err: any) {
      showToast(`${err?.message ?? 'Erro ao agendar corrida. Tenta de novo.'}`, 'error');
    } finally {
      setScheduling(null);
    }
  };

  // ── Save new contract ────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveDest = (form.dest_address || form.address || '').trim();
    const effectiveOrigin = (form.origin_address || '').trim();
    if (!dbUser?.id || !form.title.trim() || !effectiveDest || !effectiveOrigin) {
      setSaveError('Preenche o título, o ponto de recolha e o ponto de destino.');
      return;
    }
    if (effectiveDest.toLowerCase() === effectiveOrigin.toLowerCase()) {
      setSaveError('O ponto de recolha e o ponto de destino têm de ser diferentes.');
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      let dest_lat = form.dest_lat;
      let dest_lng = form.dest_lng;
      let origin_lat = form.origin_lat;
      let origin_lng = form.origin_lng;

      if (dest_lat == null || dest_lng == null) {
        const destCoords = await mapService.geocodeAddress(effectiveDest);
        dest_lat = destCoords?.lat ?? -8.836;
        dest_lng = destCoords?.lng ?? 13.234;
      }

      if (origin_lat == null || origin_lng == null) {
        const originCoords = await mapService.geocodeAddress(effectiveOrigin);
        origin_lat = originCoords?.lat ?? -8.838;
        origin_lng = originCoords?.lng ?? 13.230;
      }

      const insertPayload = {
        user_id: dbUser.id,
        contract_type: activeContractType,
        title: form.title.trim(),
        address: effectiveDest,
        origin_address: effectiveOrigin,
        dest_address: effectiveDest,
        origin_lat,
        origin_lng,
        dest_lat,
        dest_lng,
        time_start: form.time_start,
        time_end: form.time_end,
        parent_monitoring: form.parent_monitoring,
        route_deviation_alert: form.route_deviation_alert,
        max_deviation_km: form.max_deviation_km,
        contact_name: form.contact_name || null,
        contact_phone: form.contact_phone || null,
        active: true,
        km_accumulated: 0,
        bonus_kz: 0,
      };

      const { data: inserted, error } = await supabase.from('contracts').insert(insertPayload).select().maybeSingle();

      if (error) {
        console.error('[Contract] Insert falhou:', error);
        setSaveError(`Erro: ${error.message || 'Tabela indisponivel. Contacta o suporte.'}`);
        return;
      }

      // Adicionar contrato ao estado local imediatamente para o dono ver
      if (inserted) {
        setContracts(prev => [inserted as ContractRecord, ...prev]);
      } else {
        // Fallback: criar objecto local com os dados do formulário
        const localContract = {
          ...insertPayload,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          monthly_credit_kz: null,
          credit_remaining_kz: null,
          discount_pct: null,
          payment_status: null,
        } as unknown as ContractRecord;
        setContracts(prev => [localContract, ...prev]);
      }

      setShowAddForm(false);
      setForm(EMPTY_CONTRACT_FORM);
      // Sincronizar em background (pode falhar por RLS sem impacto)
      loadData().catch(err => console.warn('[Contract] Background sync falhou:', err));
      showToast('Contrato criado com sucesso!', 'success');
    } catch (err: any) {
      setSaveError(`Erro inesperado: ${err?.message || 'Verifica a ligacao.'}`);
    } finally {
      setSaving(false);
    }
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
            <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>description</span> Contratos
          </button>
          <button
            onClick={() => setActiveTab('pass')}
            className={`zr-chip ${activeTab === 'pass' ? 'zr-chip--gold' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>confirmation_number</span> Zenith Pass
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
                    <strong style={{ color: 'var(--gold)' }}>Bónus Fidelidade: 70 km</strong>
                  </div>
                  {kmBonus.free_km_available > 0 && (
                    <span className="zr-chip zr-chip--gold"><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>redeem</span> {kmBonus.free_km_available.toFixed(0)} km GRÁTIS</span>
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
              <AddContractForm
                activeContractType={activeContractType}
                onChangeContractType={setActiveContractType}
                form={form}
                onFormChange={setForm}
                saving={saving}
                saveError={saveError}
                onSubmit={handleSave}
                onCancel={() => setShowAddForm(false)}
              />
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

export default Contract;
