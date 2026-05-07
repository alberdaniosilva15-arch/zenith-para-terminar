import sys

with open('src/components/DriverActiveCard.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace main structure
code = code.replace('''  return (
    <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
      <div className="flex gap-4 items-start">
        <div className="w-10 h-10 golden-gradient rounded-2xl flex items-center justify-center text-lg font-headline font-bold shrink-0">
          {(ride.passengerName ?? 'P').charAt(0)}
        </div>
        <div>
          <p className="font-black text-on-surface text-sm">Corrida activa</p>
          <p className="text-[10px] text-on-surface-variant font-label truncate">
            {ride.pickup} → {ride.destination}
          </p>
        </div>
      </div>

      <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
        <AgoraCall
          corridaId={ride.rideId}
          userId={driverId}
          peerName={ride.passengerName ?? 'Passageiro'}
          onEndCall={() => {}}
        />
      </Suspense>

      {/* Chat directo com o passageiro */}
      <RideChat
        rideId={ride.rideId}
        myId={driverId}
        peerName={ride.passengerName ?? 'Passageiro'}
        phonePrivacyMode={true}
      />

      <button
        onClick={() => onAdvanceStatus(currentAction.next)}
        className="w-full py-5 golden-gradient rounded-3xl font-black text-[10px] uppercase tracking-widest vault-shadow active:scale-95 luxury-transition"
      >
        {currentAction.label}
      </button>
      <button
        onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
        className="w-full py-3 text-error font-black text-[9px] uppercase tracking-widest hover:bg-error/10 rounded-2xl luxury-transition"
      >
        Cancelar corrida
      </button>
    </div>
  );''', '''  return (
    <div className="zr-card zr-card--hero" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      <div className="zr-inline" style={{ gap: '16px', alignItems: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--gold)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold' }}>
          {(ride.passengerName ?? 'P').charAt(0)}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <p className="zr-kicker" style={{ color: 'var(--gold)', margin: 0 }}>Passageiro a bordo</p>
          <h3 className="zr-section-title" style={{ fontSize: '18px', margin: '4px 0', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ride.passengerName ?? 'Passageiro'}</h3>
          <p className="zr-meta" style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            <span style={{ color: 'var(--success)' }}>{ride.pickup}</span> → {ride.destination}
          </p>
        </div>
      </div>

      <div className="zr-card zr-card--info" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="zr-inline zr-inline--between">
          <span className="zr-meta" style={{ color: 'inherit' }}>Comunicação Segura</span>
          <span className="zr-chip zr-chip--info" style={{ fontSize: '9px' }}>VoIP Activo</span>
        </div>
        <Suspense fallback={<div className="zr-loading-dots" style={{ alignSelf: 'center' }}><span></span><span></span><span></span></div>}>
          <AgoraCall
            corridaId={ride.rideId}
            userId={driverId}
            peerName={ride.passengerName ?? 'Passageiro'}
            onEndCall={() => {}}
          />
        </Suspense>
      </div>

      <div className="zr-card zr-card--success" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ display: 'block', fontSize: '14px', color: '#166534' }}>Live Share</strong>
          <span className="zr-meta" style={{ color: '#166534', opacity: 0.8 }}>Partilhar localização</span>
        </div>
        <button className="zr-button" style={{ backgroundColor: '#15803d', color: '#fff' }} onClick={() => {
          navigator.clipboard.writeText(`${window.location.origin}/track/${ride.rideId}`);
          alert('Link copiado!');
        }}>
          Copiar Link
        </button>
      </div>

      <div style={{ marginTop: '8px' }}>
        <RideChat
          rideId={ride.rideId}
          myId={driverId}
          peerName={ride.passengerName ?? 'Passageiro'}
          phonePrivacyMode={true}
        />
      </div>

      <div className="zr-stack" style={{ gap: '12px', marginTop: '16px' }}>
        <button
          onClick={() => onAdvanceStatus(currentAction.next)}
          className="zr-button zr-button--block"
          style={{ fontSize: '14px', padding: '16px' }}
        >
          {currentAction.label}
        </button>
        <button
          onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
          className="zr-button zr-button--danger zr-button--block zr-button--ghost"
        >
          Cancelar corrida
        </button>
      </div>
    </div>
  );''')

with open('src/components/DriverActiveCard.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("DriverActiveCard replaced")
