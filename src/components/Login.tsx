// =============================================================================
// ZENITH RIDE — Login.tsx — MFUMU ZENITH EDITION
// Design: Vantablack & Gold · Supabase Auth real
// =============================================================================

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

type Screen = 'signin' | 'signup';

const Login: React.FC = () => {
  const { signIn, signUp } = useAuth();

  const [screen,   setScreen]   = useState<Screen>('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [role,     setRole]     = useState<UserRole>(UserRole.PASSENGER);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState<string | null>(null);

  const reset = () => { setError(null); setSuccess(null); };

  const handleSignIn = async () => {
    if (!email || !password) { setError('Preenche email e palavra-passe.'); return; }
    setLoading(true); reset();
    const err = await signIn(email, password);
    setLoading(false);
    if (err) setError(err.message);
  };

  const handleSignUp = async () => {
    if (!email || !password || !name) { setError('Preenche todos os campos.'); return; }
    if (password.length < 6) { setError('A palavra-passe deve ter pelo menos 6 caracteres.'); return; }
    setLoading(true); reset();
    const err = await signUp(email, password, name, role);
    setLoading(false);
    if (err) { setError(err.message); }
    else { setSuccess('Conta criada! Confirma o teu email para entrar.'); setScreen('signin'); }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden relative"
      style={{ backgroundColor: '#0B0B0B' }}
    >
      {/* Background gold orb */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(230,195,100,0.07) 0%, transparent 70%)' }} />
      <div className="absolute bottom-0 right-0 w-80 h-80 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,168,76,0.04) 0%, transparent 70%)' }} />
      {/* Grain */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.02'/%3E%3C/svg%3E\")" }} />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center space-y-10">
        {/* Logo */}
        <div className="text-center space-y-3">
          <h1 className="font-headline italic font-bold text-5xl tracking-tight"
            style={{ color: '#E6C364', textShadow: '0 0 30px rgba(230,195,100,0.35)' }}>
            Zenith Ride
          </h1>
          <p className="font-label uppercase tracking-[0.2em] text-xs font-light"
            style={{ color: 'rgba(230,195,100,0.5)' }}>
            IA Independente · Luanda 2026
          </p>
        </div>

        {/* Toggle */}
        <div className="flex w-full rounded-xl overflow-hidden" style={{ border: '1px solid rgba(230,195,100,0.2)' }}>
          {(['signin', 'signup'] as Screen[]).map(s => (
            <button key={s} onClick={() => { setScreen(s); reset(); }}
              className="flex-1 py-3 font-label text-[10px] uppercase tracking-widest font-bold transition-all duration-300"
              style={{
                background: screen === s ? 'linear-gradient(135deg, #C9A84C, #E6C364)' : 'transparent',
                color: screen === s ? '#0B0B0B' : 'rgba(230,195,100,0.5)',
              }}>
              {s === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        {/* Alerts */}
        {error && (
          <div className="w-full p-4 rounded-xl text-xs font-bold text-center"
            style={{ background: 'rgba(255,180,171,0.08)', border: '1px solid rgba(255,180,171,0.3)', color: '#ffb4ab' }}>
            {error}
          </div>
        )}
        {success && (
          <div className="w-full p-4 rounded-xl text-xs font-bold text-center"
            style={{ background: 'rgba(230,195,100,0.08)', border: '1px solid rgba(230,195,100,0.3)', color: '#E6C364' }}>
            {success}
          </div>
        )}

        {/* Form */}
        <div className="w-full space-y-5">
          {screen === 'signup' && (
            <ZenithField label="Nome completo" type="text" value={name} onChange={setName} placeholder="Mário Bento" icon="person" />
          )}
          <ZenithField label="Email" type="email" value={email} onChange={setEmail} placeholder="exemplo@gmail.com" icon="mail" />
          <ZenithField label="Chave de Acesso" type="password" value={password} onChange={setPassword} placeholder="••••••••" icon="lock" />

          {screen === 'signup' && (
            <div className="space-y-2">
              <label className="font-label text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(230,195,100,0.5)' }}>
                Entrar como
              </label>
              <div className="grid grid-cols-2 gap-3">
                <RoleBtn label="Passageiro" icon="person" active={role === UserRole.PASSENGER} onClick={() => setRole(UserRole.PASSENGER)} />
                <RoleBtn label="Motorista" icon="two_wheeler" active={role === UserRole.DRIVER} onClick={() => setRole(UserRole.DRIVER)} />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={screen === 'signin' ? handleSignIn : handleSignUp}
          disabled={loading}
          className="w-full h-16 rounded-full font-label font-extrabold text-sm uppercase tracking-[0.2em] active:scale-95 transition-all duration-300 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #C9A84C 0%, #E6C364 100%)', color: '#0B0B0B', boxShadow: '0 0 30px rgba(201,168,76,0.4)' }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-4 h-4 border-2 border-[#0B0B0B]/30 border-t-[#0B0B0B] rounded-full animate-spin" />
              A processar...
            </span>
          ) : screen === 'signin' ? 'ENTRAR' : 'CRIAR CONTA'}
        </button>

        {/* Quick role buttons (signin) */}
        {screen === 'signin' && (
          <div className="w-full grid grid-cols-2 gap-4">
            <QuickBtn icon="two_wheeler" label="MOTORISTA" />
            <QuickBtn icon="shield" label="ADMIN" />
          </div>
        )}

        <a href="#" className="text-[10px] font-label uppercase tracking-widest transition-colors"
          style={{ color: 'rgba(230,195,100,0.3)' }}>
          Recuperar Acesso · Suporte MFUMU
        </a>
      </div>

      {/* Bottom decoration */}
      <div className="fixed bottom-10 w-32 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(230,195,100,0.1)' }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: '#E6C364', boxShadow: '0 0 10px #E6C364' }} />
      </div>
    </div>
  );
};

const ZenithField: React.FC<{
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string; icon: string;
}> = ({ label, type, value, onChange, placeholder, icon }) => (
  <div className="space-y-2">
    <label className="font-label text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(230,195,100,0.5)' }}>
      {label}
    </label>
    <div className="relative flex items-center rounded-xl px-4 py-4 transition-all duration-300"
      style={{ background: 'rgba(230,195,100,0.06)', border: '1px solid rgba(230,195,100,0.2)' }}>
      <span className="material-symbols-outlined mr-3 text-lg" style={{ color: 'rgba(230,195,100,0.6)' }}>{icon}</span>
      <input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'name'}
        className="bg-transparent border-none p-0 w-full focus:ring-0 font-body text-sm outline-none placeholder:text-on-surface-variant/30"
        style={{ color: '#E6C364' }}
      />
    </div>
  </div>
);

const RoleBtn: React.FC<{ label: string; icon: string; active: boolean; onClick: () => void }> = ({ label, icon, active, onClick }) => (
  <button onClick={onClick}
    className="flex items-center justify-center gap-2 py-4 rounded-xl font-label font-bold text-[10px] uppercase tracking-widest transition-all duration-300 active:scale-95"
    style={{
      border: `1px solid ${active ? '#E6C364' : 'rgba(230,195,100,0.2)'}`,
      background: active ? 'rgba(230,195,100,0.12)' : 'transparent',
      color: active ? '#E6C364' : 'rgba(230,195,100,0.4)',
    }}>
    <span className="material-symbols-outlined text-lg">{icon}</span>
    {label}
  </button>
);

const QuickBtn: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <button className="flex items-center justify-center gap-2 py-4 rounded-xl font-label text-[11px] uppercase tracking-wider transition-all duration-300 active:scale-95"
    style={{ border: '1px solid rgba(230,195,100,0.2)', background: 'transparent', color: 'rgba(230,195,100,0.5)' }}>
    <span className="material-symbols-outlined text-xl">{icon}</span>
    {label}
  </button>
);

export default Login;
