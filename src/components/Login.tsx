// =============================================================================
// ZENITH RIDE - Login.tsx - MFUMU ZENITH EDITION
// Design: Vantablack & Gold · Supabase Auth real
// =============================================================================

import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { UserRole } from '../types';

type Screen = 'signin' | 'signup' | 'forgot' | 'reset';

const RECOVERY_PATH = '/login?type=recovery';
const ROLE_INTENT_STORAGE_KEY = 'auth_role_intent';
const LEGACY_ROLE_INTENT_STORAGE_KEY = 'oauth_role_intent';

const Login: React.FC = () => {
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const [screen, setScreen] = useState<Screen>(() => (
    hasRecoveryType(window.location.search, window.location.hash) ? 'reset' : 'signin'
  ));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.PASSENGER);
  const [authRole, setAuthRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isPasswordRole = role === UserRole.DRIVER || role === UserRole.FLEET_OWNER;
  const isPasswordAuthRole = authRole === UserRole.DRIVER || authRole === UserRole.FLEET_OWNER;

  const clearFeedback = () => {
    setError(null);
    setSuccess(null);
  };

  const clearPasswordFields = () => {
    setPassword('');
    setConfirmPassword('');
  };

  const switchScreen = (next: Screen) => {
    setScreen(next);
    clearFeedback();

    if (next !== 'forgot') {
      clearPasswordFields();
    }

    if (next !== 'signin') {
      setAuthRole(null);
    }
  };

  useEffect(() => {
    const syncRecoveryState = () => {
      if (hasRecoveryType(window.location.search, window.location.hash)) {
        setError(null);
        setSuccess(null);
        setPassword('');
        setConfirmPassword('');
        setScreen('reset');
      }
    };

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('cleared') === '1') {
      setError(null);
      setSuccess('Sessao anterior terminada neste dispositivo. Ja podes entrar noutra conta.');
    }

    syncRecoveryState();
    window.addEventListener('hashchange', syncRecoveryState);
    window.addEventListener('popstate', syncRecoveryState);

    return () => {
      window.removeEventListener('hashchange', syncRecoveryState);
      window.removeEventListener('popstate', syncRecoveryState);
    };
  }, []);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Preenche email e palavra-passe.');
      return;
    }

    persistRoleIntent(authRole);
    setLoading(true);
    clearFeedback();
    const err = await signIn(email, password);
    setLoading(false);

    if (err) {
      setError(err.message);
    }
  };

  const handleSendMagicLink = async () => {
    if (!email) {
      setError('Indica o email para onde enviar o link.');
      return;
    }

    persistRoleIntent(null);
    setLoading(true);
    clearFeedback();

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess('Link de acesso enviado! Verifica o teu email (e a pasta de spam).');
      }
    } catch (e: any) {
      setError(e.message ?? 'Erro ao enviar link.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Indica o email para recuperar a palavra-passe.');
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess('Email de recuperação enviado! Abre o link para redefinir a palavra-passe.');
      }
    } catch (e: any) {
      setError(e.message ?? 'Erro ao enviar recuperação.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!password || password.length < 6) {
      setError('A palavra-passe deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As palavras-passe não coincidem.');
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError(error.message);
        return;
      }

      setSuccess('Palavra-passe atualizada com sucesso. Vamos abrir a tua conta.');
      clearPasswordFields();
      window.setTimeout(() => {
        window.location.href = '/';
      }, 900);
    } catch (e: any) {
      setError(e.message ?? 'Erro ao atualizar a palavra-passe.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async (targetRole: UserRole) => {
    setLoading(true);
    clearFeedback();
    const err = await signInWithGoogle(targetRole);
    setLoading(false);

    if (err) {
      setError(err.message);
    }
  };

  const handleSignUp = async () => {
    if (!email || !name) {
      setError('Preenche todos os campos.');
      return;
    }

    if (isPasswordRole) {
      if (!password || password.length < 6) {
        setError('Define uma palavra-passe com pelo menos 6 caracteres.');
        return;
      }

      persistRoleIntent(role);
      setLoading(true);
      clearFeedback();
      const err = await signUp(email, password, name, role);
      setLoading(false);

      if (err) {
        setError(err.message);
      } else {
        setSuccess(
          role === UserRole.FLEET_OWNER
            ? 'Conta criada! Confirma o teu email para entrares como dono de frota.'
            : 'Conta criada! Confirma o teu email para entrares como motorista.',
        );
        clearPasswordFields();
        setScreen('signin');
        setAuthRole(role);
      }

      return;
    }

    setLoading(true);
    clearFeedback();
    persistRoleIntent(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          data: { name, role: 'passenger' },
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess('Link mágico enviado! Verifica o teu email (e a pasta de spam).');
        setScreen('signin');
      }
    } catch (e: any) {
      setError(e.message ?? 'Erro ao enviar link.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (screen === 'forgot') {
      return handleForgotPassword();
    }

    if (screen === 'reset') {
      return handleResetPassword();
    }

    if (screen === 'signin') {
      if (isPasswordAuthRole) {
        return handleSignIn();
      }

      return handleSendMagicLink();
    }

    return handleSignUp();
  };

  const showDriverGoogleAction =
    (screen === 'signin' && isPasswordAuthRole) ||
    (screen === 'signup' && isPasswordRole);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden relative"
      style={{ backgroundColor: '#0B0B0B' }}
    >
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(230,195,100,0.07) 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-0 right-0 w-80 h-80 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,168,76,0.04) 0%, transparent 70%)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.02'/%3E%3C/svg%3E\")" }}
      />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center space-y-10">
        <div className="text-center space-y-3 relative">
          <h1
            className="font-headline italic font-bold text-5xl tracking-tight relative z-10 inline-flex items-center justify-center"
            style={{ color: '#E6C364', textShadow: '0 0 30px rgba(230,195,100,0.35)' }}
          >
            <span className="animate-shimmer">Zenith</span>
            <span className="ml-3 text-2xl" style={{ color: '#E6C364', textShadow: '0 0 18px rgba(230,195,100,0.25)' }}>
              Ride
            </span>
          </h1>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="zenith-orb" />
          </div>
        </div>

        {screen !== 'reset' ? (
          <div className="flex w-full rounded-xl overflow-hidden" style={{ border: '1px solid rgba(230,195,100,0.2)' }}>
            {(['signin', 'signup', 'forgot'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => switchScreen(tab)}
                className="flex-1 py-3 font-label text-[10px] uppercase tracking-widest font-bold transition-all duration-300"
                style={{
                  background: screen === tab ? 'linear-gradient(135deg, #C9A84C, #E6C364)' : 'transparent',
                  color: screen === tab ? '#0B0B0B' : 'rgba(230,195,100,0.5)',
                }}
              >
                {tab === 'signin' ? 'Entrar' : tab === 'signup' ? 'Criar conta' : 'Recuperar'}
              </button>
            ))}
          </div>
        ) : (
          <div
            className="w-full rounded-2xl px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.22em]"
            style={{ border: '1px solid rgba(230,195,100,0.28)', color: '#E6C364', background: 'rgba(230,195,100,0.06)' }}
          >
            Redefinir palavra-passe
          </div>
        )}

        {error && (
          <div
            className="w-full p-4 rounded-xl text-xs font-bold text-center"
            style={{ background: 'rgba(255,180,171,0.08)', border: '1px solid rgba(255,180,171,0.3)', color: '#ffb4ab' }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className="w-full p-4 rounded-xl text-xs font-bold text-center"
            style={{ background: 'rgba(230,195,100,0.08)', border: '1px solid rgba(230,195,100,0.3)', color: '#E6C364' }}
          >
            {success}
          </div>
        )}

        <div className="w-full space-y-5">
          {screen === 'reset' && (
            <>
              <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                Introduz a nova palavra-passe para concluir a recuperação.
              </p>
              <ZenithField
                label="Nova palavra-passe"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Minimo de 6 caracteres"
                icon="lock"
                autoComplete="new-password"
              />
              <ZenithField
                label="Confirmar palavra-passe"
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Repete a palavra-passe"
                icon="verified_user"
                autoComplete="new-password"
              />
            </>
          )}

          {screen === 'forgot' && (
            <>
              <ZenithField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="exemplo@gmail.com"
                icon="mail"
              />
              <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                Vamos enviar um link seguro para redefinir a tua palavra-passe.
              </p>
            </>
          )}

          {screen === 'signin' && (
            <>
              <ZenithField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="exemplo@gmail.com"
                icon="mail"
              />

              {isPasswordAuthRole ? (
                <>
                  <ZenithField
                    label="Palavra-passe"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="A tua palavra-passe"
                    icon="lock"
                    autoComplete="current-password"
                  />
                  <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                    {authRole === UserRole.FLEET_OWNER
                      ? 'Donos de frota entram com email e palavra-passe, com Google como alternativa.'
                      : 'Motoristas podem entrar com email e palavra-passe ou continuar com Google.'}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                  Os passageiros entram com link mágico enviado por email.
                </p>
              )}
            </>
          )}

          {screen === 'signup' && (
            <>
              <div className="space-y-2">
                <label className="font-label text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(230,195,100,0.5)' }}>
                  Criar conta como
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <RoleBtn
                    label="Passageiro"
                    icon="person"
                    active={role === UserRole.PASSENGER}
                    onClick={() => {
                      setRole(UserRole.PASSENGER);
                      clearFeedback();
                      clearPasswordFields();
                    }}
                  />
                  <RoleBtn
                    label="Motorista"
                    icon="two_wheeler"
                    active={role === UserRole.DRIVER}
                    onClick={() => {
                      setRole(UserRole.DRIVER);
                      clearFeedback();
                      clearPasswordFields();
                    }}
                  />
                  <RoleBtn
                    label="Frota"
                    icon="apartment"
                    active={role === UserRole.FLEET_OWNER}
                    onClick={() => {
                      setRole(UserRole.FLEET_OWNER);
                      clearFeedback();
                      clearPasswordFields();
                    }}
                  />
                </div>
              </div>

              <ZenithField
                label="Nome completo"
                type="text"
                value={name}
                onChange={setName}
                placeholder="Mario Bento"
                icon="person"
              />
              <ZenithField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="exemplo@gmail.com"
                icon="mail"
              />

              {isPasswordRole ? (
                <>
                  <ZenithField
                    label="Palavra-passe"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Minimo de 6 caracteres"
                    icon="lock"
                    autoComplete="new-password"
                  />
                  <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                    {role === UserRole.FLEET_OWNER
                      ? 'A conta do dono de frota usa email e palavra-passe, com Google como alternativa.'
                      : 'A conta de motorista usa email e palavra-passe, com Google como alternativa.'}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-on-surface-variant/70 mt-1 font-bold text-center">
                  Os passageiros usam link mágico enviado por email - não é necessária password.
                </p>
              )}
            </>
          )}
        </div>

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
          ) : (
            getPrimaryLabel(screen, authRole)
          )}
        </button>

        {showDriverGoogleAction && (
          <button
            onClick={() => handleGoogleAuth(authRole ?? role)}
            disabled={loading}
            className="w-full h-14 rounded-full flex items-center justify-center gap-3 font-label font-extrabold text-sm uppercase tracking-[0.16em] active:scale-95 transition-all duration-300 disabled:opacity-50"
            style={{ background: '#FFFFFF', color: '#0B0B0B', boxShadow: '0 0 20px rgba(255,255,255,0.1)' }}
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-[#0B0B0B]/30 border-t-[#0B0B0B] rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continuar com Google
              </>
            )}
          </button>
        )}

        {screen === 'signin' && (
          <div className="w-full grid grid-cols-3 gap-4">
            <QuickBtn
              icon="person"
              label="PASSAGEIRO"
              onClick={() => {
                setAuthRole(null);
                clearFeedback();
                clearPasswordFields();
              }}
              active={authRole === null}
            />
            <QuickBtn
              icon="two_wheeler"
              label="MOTORISTA"
              onClick={() => {
                setAuthRole(UserRole.DRIVER);
                clearFeedback();
                clearPasswordFields();
              }}
              active={authRole === UserRole.DRIVER}
            />
            <QuickBtn
              icon="apartment"
              label="FROTA"
              onClick={() => {
                setAuthRole(UserRole.FLEET_OWNER);
                clearFeedback();
                clearPasswordFields();
              }}
              active={authRole === UserRole.FLEET_OWNER}
            />
          </div>
        )}

        {screen === 'signin' && !isPasswordAuthRole && (
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

        {screen === 'reset' ? (
          <button
            onClick={() => switchScreen('signin')}
            className="text-[10px] font-label uppercase tracking-widest transition-colors"
            style={{ color: 'rgba(230,195,100,0.3)' }}
          >
            Voltar ao login
          </button>
        ) : (
          <button
            onClick={() => switchScreen('forgot')}
            className="text-[10px] font-label uppercase tracking-widest transition-colors"
            style={{ color: 'rgba(230,195,100,0.3)' }}
          >
            Esqueci-me da Palavra-Passe
          </button>
        )}
      </div>
    </div>
  );
};

const ZenithField: React.FC<{
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: string;
  autoComplete?: string;
}> = ({ label, type, value, onChange, placeholder, icon, autoComplete }) => (
  <div className="space-y-2">
    <label className="font-label text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(230,195,100,0.5)' }}>
      {label}
    </label>
    <div
      className="relative flex items-center rounded-xl px-4 py-4 transition-all duration-300"
      style={{ background: 'rgba(230,195,100,0.06)', border: '1px solid rgba(230,195,100,0.2)' }}
    >
      <span className="material-symbols-outlined mr-3 text-lg" style={{ color: 'rgba(230,195,100,0.6)' }}>
        {icon}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete ?? (type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'name')}
        className="bg-transparent border-none p-0 w-full focus:ring-0 font-body text-sm outline-none placeholder:text-on-surface-variant/30"
        style={{ color: '#E6C364' }}
      />
    </div>
  </div>
);

const RoleBtn: React.FC<{ label: string; icon: string; active: boolean; onClick: () => void }> = ({ label, icon, active, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center gap-2 py-4 rounded-xl font-label font-bold text-[10px] uppercase tracking-widest transition-all duration-300 active:scale-95"
    style={{
      border: `1px solid ${active ? '#E6C364' : 'rgba(230,195,100,0.2)'}`,
      background: active ? 'rgba(230,195,100,0.12)' : 'transparent',
      color: active ? '#E6C364' : 'rgba(230,195,100,0.4)',
    }}
  >
    <span className="material-symbols-outlined text-lg">{icon}</span>
    {label}
  </button>
);

const QuickBtn: React.FC<{ icon: string; label: string; onClick?: () => void; active?: boolean }> = ({ icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center gap-2 py-4 rounded-xl font-label text-[11px] uppercase tracking-wider transition-all duration-300 active:scale-95"
    style={{
      border: `1px solid ${active ? 'rgba(230,195,100,0.6)' : 'rgba(230,195,100,0.2)'}`,
      background: active ? 'rgba(230,195,100,0.10)' : 'transparent',
      color: active ? '#E6C364' : 'rgba(230,195,100,0.5)',
    }}
  >
    <span className="material-symbols-outlined text-xl">{icon}</span>
    {label}
  </button>
);

function hasRecoveryType(search: string, hash: string): boolean {
  const searchParams = new URLSearchParams(search);
  if (searchParams.get('type') === 'recovery') {
    return true;
  }

  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!normalizedHash) {
    return false;
  }

  const hashParams = new URLSearchParams(normalizedHash);
  return hashParams.get('type') === 'recovery';
}

function getPrimaryLabel(screen: Screen, authRole: UserRole | null): string {
  if (screen === 'forgot') {
    return 'ENVIAR RECUPERACAO';
  }

  if (screen === 'reset') {
    return 'DEFINIR PALAVRA-PASSE';
  }

  if (screen === 'signin') {
    return authRole === UserRole.DRIVER || authRole === UserRole.FLEET_OWNER ? 'ENTRAR' : 'ENVIAR LINK MAGICO';
  }

  return 'CRIAR CONTA';
}

function persistRoleIntent(role: UserRole | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (role === UserRole.DRIVER || role === UserRole.FLEET_OWNER) {
    window.localStorage.setItem(ROLE_INTENT_STORAGE_KEY, role);
    window.localStorage.setItem(LEGACY_ROLE_INTENT_STORAGE_KEY, role);
    return;
  }

  window.localStorage.removeItem(ROLE_INTENT_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_ROLE_INTENT_STORAGE_KEY);
}

export default Login;
