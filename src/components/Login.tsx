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
  const { signIn, signUp, signInWithGoogle } = useAuth();

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
      if (authRole === UserRole.DRIVER) return handleGoogleAuth(UserRole.DRIVER);
      return handleSendMagicLink();
    }
    
    if (role === UserRole.DRIVER) return handleGoogleAuth(UserRole.DRIVER);
    return handleSignUp();
  };

  const handleGoogleAuth = async (targetRole: UserRole) => {
    setLoading(true); reset();
    const err = await signInWithGoogle(targetRole);
    setLoading(false);
    if (err) setError(err.message);
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

    // Se chegar aqui para signup, será passageiro com magic link (pois motoristas fazem bypass via google)
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
          {/* Fields only for passengers or fallback */}
          {((screen === 'signup' && role === UserRole.PASSENGER) || (screen === 'signin' && authRole === UserRole.PASSENGER) || authRole === null && role === UserRole.PASSENGER) && (
            <>
              {screen === 'signup' && (
                <ZenithField label="Nome completo" type="text" value={name} onChange={setName} placeholder="Mário Bento" icon="person" />
              )}
              <ZenithField label="Email" type="email" value={email} onChange={setEmail} placeholder="exemplo@gmail.com" icon="mail" />
            </>
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
        {((screen === 'signup' && role === UserRole.DRIVER) || (screen === 'signin' && authRole === UserRole.DRIVER)) ? (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full h-16 rounded-full flex items-center justify-center gap-3 font-label font-extrabold text-sm uppercase tracking-[0.2em] active:scale-95 transition-all duration-300 disabled:opacity-50"
            style={{ background: '#FFFFFF', color: '#0B0B0B', boxShadow: '0 0 20px rgba(255,255,255,0.1)' }}
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-[#0B0B0B]/30 border-t-[#0B0B0B] rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                CONTINUAR COM GOOGLE
              </>
            )}
          </button>
        ) : (
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
            ) : (screen === 'signin' ? 'ENVIAR LINK MÁGICO' : 'CRIAR CONTA')}
          </button>
        )}

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
