// =============================================================================
// ZENITH RIDE — Login.tsx — MFUMU ZENITH EDITION
// Design: Vantablack & Gold · Supabase Auth real
// =============================================================================

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { UserRole } from '../types';

type Screen = 'signin' | 'signup';

const Login: React.FC = () => {
  const { signIn, signUp } = useAuth();

  const [screen,   setScreen]   = useState<Screen>('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [role,     setRole]     = useState<UserRole>(UserRole.PASSENGER);
  // authRole controls signin behavior: driver => password required, null => passwordless (passenger)
  const [authRole, setAuthRole] = useState<UserRole | null>(null);
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

  const handleSendMagicLink = async () => {
    if (!email) { setError('Indica o email para onde enviar o link.'); return; }
    setLoading(true); reset();
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) setError(error.message);
      else setSuccess('Link de acesso enviado! Verifica o teu email (verifica spam).');
    } catch (e: any) {
      setError(e.message ?? 'Erro ao enviar link.');
    } finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    if (screen === 'signin') {
      // Signin flow: drivers use password, others use magic link
      if (authRole === UserRole.DRIVER) return handleSignIn();
      return handleSendMagicLink();
    }
    // Signup flow
    return handleSignUp();
  };

  const handleSignUp = async () => {
    // Passengers: passwordless (magic link). Drivers: password signup.
    if (!email || !name) { setError('Preenche todos os campos.'); return; }

    if (role === UserRole.PASSENGER) {
      setLoading(true); reset();
      try {
        const { error } = await supabase.auth.signInWithOtp({ 
          email, 
          options: { 
            data: { name, role: 'passenger' }, 
            emailRedirectTo: window.location.origin 
          } 
        });
        if (error) setError(error.message);
        else {
          setSuccess('Link mágico enviado! Verifica o teu email (verifica spam).');
          setScreen('signin');
        }
      } catch (e: any) {
        setError(e.message ?? 'Erro ao enviar link.');
      } finally { setLoading(false); }
      return;
    }

    // Driver signup requires password
    if (!password) { setError('Preenche a palavra-passe.'); return; }
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
        <div className="text-center space-y-3 relative">
          <h1 className="font-headline italic font-bold text-5xl tracking-tight relative z-10 inline-flex items-center justify-center"
            style={{ color: '#E6C364', textShadow: '0 0 30px rgba(230,195,100,0.35)' }}>
            <span className="animate-shimmer">Zenith</span>
            <span className="ml-3 text-2xl" style={{ color: '#E6C364', textShadow: '0 0 18px rgba(230,195,100,0.25)' }}>Ride</span>
          </h1>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="zenith-orb" />
          </div>
        </div>

        {/* Toggle */}
        <div className="flex w-full rounded-xl overflow-hidden" style={{ border: '1px solid rgba(230,195,100,0.2)' }}>
          {(['signin', 'signup'] as Screen[]).map(s => (
            <button key={s} onClick={() => { setScreen(s); reset(); setAuthRole(null); }}
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

          {/* Password field only shown for driver signup or driver signin */}
          {((screen === 'signup' && role === UserRole.DRIVER) || (screen === 'signin' && authRole === UserRole.DRIVER)) && (
            <ZenithField label="Chave de Acesso" type="password" value={password} onChange={setPassword} placeholder="••••••••" icon="lock" />
          )}

          {screen === 'signup' && (
            <div className="space-y-2">
              <label className="font-label text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(230,195,100,0.5)' }}>
                Entrar como
              </label>
              <div className="grid grid-cols-2 gap-3">
                <RoleBtn label="Passageiro" icon="person" active={role === UserRole.PASSENGER} onClick={() => setRole(UserRole.PASSENGER)} />
                <RoleBtn label="Motorista" icon="two_wheeler" active={role === UserRole.DRIVER} onClick={() => setRole(UserRole.DRIVER)} />
              </div>
              {role === UserRole.PASSENGER && (
                <p className="text-[10px] text-on-surface-variant/70 mt-2 font-bold">Os passageiros usam link mágico enviado por email — não é necessária password.</p>
              )}
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full h-16 rounded-full font-label font-extrabold text-sm uppercase tracking-[0.2em] active:scale-95 transition-all duration-300 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #C9A84C 0%, #E6C364 100%)', color: '#0B0B0B', boxShadow: '0 0 30px rgba(201,168,76,0.4)' }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-4 h-4 border-2 border-[#0B0B0B]/30 border-t-[#0B0B0B] rounded-full animate-spin" />
              A processar...
            </span>
          ) : (screen === 'signin' ? (authRole === UserRole.DRIVER ? 'ENTRAR' : 'ENVIAR LINK MÁGICO') : 'CRIAR CONTA')}
        </button>

        {/* Botões de acesso rápido por tipo de utilizador (signin) */}
        {screen === 'signin' && (
          <div className="w-full grid grid-cols-2 gap-4">
            <QuickBtn
              icon="person"
              label="PASSAGEIRO"
              onClick={() => { setAuthRole(null); setError(null); }}
              active={authRole === null}
            />
            <QuickBtn
              icon="two_wheeler"
              label="MOTORISTA"
              onClick={() => { setAuthRole(UserRole.DRIVER); setError(null); }}
              active={authRole === UserRole.DRIVER}
            />
          </div>
        )}

        {screen === 'signin' && authRole !== UserRole.DRIVER && (
          <div className="w-full mt-3 flex gap-3">
            <button
              onClick={handleSendMagicLink}
              disabled={loading}
              className="flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest"
              style={{ border: '1px solid rgba(230,195,100,0.12)', color: 'rgba(230,195,100,0.9)', background: 'transparent' }}
            >
              Enviar link mágico
            </button>
          </div>
        )}

        <a href="#" className="text-[10px] font-label uppercase tracking-widest transition-colors"
          style={{ color: 'rgba(230,195,100,0.3)' }}>
          Recuperar Acesso · Suporte MFUMU
        </a>
      </div>

      {/* Bottom decoration removed — user requested to remove persistent loading-like bar */}
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

const QuickBtn: React.FC<{ icon: string; label: string; onClick?: () => void; active?: boolean }> = ({ icon, label, onClick, active }) => (
  <button onClick={onClick}
    className="flex items-center justify-center gap-2 py-4 rounded-xl font-label text-[11px] uppercase tracking-wider transition-all duration-300 active:scale-95"
    style={{
      border: `1px solid ${active ? 'rgba(230,195,100,0.6)' : 'rgba(230,195,100,0.2)'}`,
      background: active ? 'rgba(230,195,100,0.10)' : 'transparent',
      color: active ? '#E6C364' : 'rgba(230,195,100,0.5)',
    }}>
    <span className="material-symbols-outlined text-xl">{icon}</span>
    {label}
  </button>
);

export default Login;
