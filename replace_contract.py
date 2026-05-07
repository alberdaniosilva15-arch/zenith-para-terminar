import sys
import re

with open('src/components/Contract.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace loading
code = code.replace('''  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }''', '''  if (loading) {
    return (
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }''')

# Replace the main container and header
code = code.replace('''  return (
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
      </div>''', '''  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">MFUMU Edition · Rotas Fixas</p>
            <h2 className="zr-section-title">Contratos</h2>
          </div>
          <span className="zr-chip zr-chip--gold">ATIVO</span>
        </div>
      </header>
      <div style={{ padding: '14px' }}>''')

# Fix closing div
code = code.replace('''      {deactivatingId && (
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
};''', '''      {deactivatingId && (
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
      </div>
    </div>
  );
};''')

# Replace perk banner
code = code.replace('''      {/* 70km Perk banner */}
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
      )}''', '''      {/* 70km Perk banner */}
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
      )}''')

# Empty state
code = code.replace('''      {/* Active contracts */}
      {contracts.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <span className="material-symbols-outlined text-primary/30 text-5xl">description</span>
          <p className="font-label text-on-surface-variant text-sm">Nenhum contrato activo.</p>
          <p className="font-label text-on-surface-variant/50 text-xs">Cria um contrato escolar, familiar ou empresarial.</p>
        </div>
      ) : (''', '''      {/* Active contracts */}
      {contracts.length === 0 ? (
        <div className="zr-empty" style={{ marginBottom: '24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '16px' }}>description</span>
          <p className="zr-copy">Nenhum contrato activo.</p>
          <p className="zr-meta">Cria um contrato escolar, familiar ou empresarial.</p>
        </div>
      ) : (''')

# List replacement
code = code.replace('''        <div className="space-y-6">
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
        </div>''', '''        <div className="zr-stack" style={{ gap: '24px', marginBottom: '24px' }}>
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
        </div>''')

# Add form toggler
code = code.replace('''      ) : (
        <button onClick={() => setShowAddForm(true)}
          className="w-full py-8 rounded-2xl font-label text-[10px] uppercase tracking-[0.25em] font-bold transition-all hover:bg-primary/8 active:scale-95"
          style={{ border: '2px dashed rgba(230,195,100,0.25)', color: 'rgba(230,195,100,0.5)' }}>
          <span className="material-symbols-outlined block mb-1 text-2xl">add_circle</span>
          Adicionar Novo Contrato
        </button>
      )}''', '''      ) : (
        <button onClick={() => setShowAddForm(true)} className="zr-button zr-button--secondary zr-button--block" style={{ borderStyle: 'dashed' }}>
          <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>add_circle</span>
          Adicionar Novo Contrato
        </button>
      )}''')

# Add form completely
form_old = '''      {/* Add form */}
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
      ) : ('''

form_new = '''      {/* Add form */}
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
      ) : ('''
code = code.replace(form_old, form_new)

# ContractCard Component
card_old = '''  return (
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
  );'''

card_new = '''  return (
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
  );'''
code = code.replace(card_old, card_new)

# Sub-components
sub_old = '''// ─── Sub-components ───────────────────────────────────────────────────────────
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
);'''

sub_new = '''// ─── Sub-components ───────────────────────────────────────────────────────────
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
);'''

code = code.replace(sub_old, sub_new)

with open('src/components/Contract.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Replacement for Contract done")
