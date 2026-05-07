// =============================================================================
// ZENITH RIDE - Login.tsx - MFUMU ZENITH EDITION
// Design: Vantablack & Gold · Supabase Auth real
// =============================================================================

import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { UserRole } from '../types';
import { hasRecoveryType } from '../lib/authUtils';

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



  return (
    <div className="zr-shell" style={{ backgroundColor: '#000000' }}>
      <div className="zr-app zr-app--login" style={{ backgroundColor: '#000000' }}>
        <main className="zr-main" style={{ paddingTop: '20px', paddingBottom: '20px' }}>
          <section className="zr-card zr-card--hero" style={{ backgroundColor: '#000000', backgroundImage: 'none' }}>
            <div className="flex justify-center mb-6 mt-2">
              <video 
                src="/zenith-emblem-loop.mp4" 
                autoPlay 
                loop 
                muted 
                playsInline
                preload="metadata"
                className="w-[160px] h-auto object-contain drop-shadow-[0_0_25px_rgba(230,195,100,0.4)]" 
                style={{ backgroundColor: 'transparent' }}
              />
            </div>
            <p className="zr-kicker" style={{ textAlign: 'center' }}>Acesso Zenith</p>
            <h1 className="zr-title" style={{ textAlign: 'center' }}>Introduz as tuas<br/>credenciais</h1>
            <p className="zr-subtitle" style={{ textAlign: 'center' }}>
              Fluxo completo de entrada, registo, recuperação, redefinição, Google e escolha de papel.
            </p>
            <div className="zr-tabs" style={{ marginTop: '18px' }}>
              <button onClick={() => switchScreen('signin')} className={`zr-tab ${screen === 'signin' ? 'is-active' : ''}`}>Entrar</button>
              <button onClick={() => switchScreen('signup')} className={`zr-tab ${screen === 'signup' ? 'is-active' : ''}`}>Criar conta</button>
              <button onClick={() => switchScreen('forgot')} className={`zr-tab ${screen === 'forgot' ? 'is-active' : ''}`}>Recuperar</button>
            </div>

            <div className="zr-stack" style={{ marginTop: '18px' }}>
              {error && (
                <div className="zr-alert-box zr-alert-box--danger">
                  <p className="zr-note" style={{ color: '#fda4af' }}>{error}</p>
                </div>
              )}
              {success && (
                <div className="zr-alert-box zr-alert-box--success">
                  <p className="zr-note" style={{ color: '#86efac' }}>{success}</p>
                </div>
              )}

              {screen === 'signin' && (
                <section>
                  <p className="zr-label">Entrar como</p>
                  <div className="zr-role-grid">
                    <button onClick={() => setAuthRole(UserRole.PASSENGER)} className={`zr-role-card ${authRole === UserRole.PASSENGER || !authRole ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">person</span> Passageiro
                    </button>
                    <button onClick={() => setAuthRole(UserRole.DRIVER)} className={`zr-role-card ${authRole === UserRole.DRIVER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">two_wheeler</span> Motorista
                    </button>
                    <button onClick={() => setAuthRole(UserRole.FLEET_OWNER)} className={`zr-role-card ${authRole === UserRole.FLEET_OWNER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">apartment</span> Frota
                    </button>
                  </div>
                  <div className="zr-stack" style={{ marginTop: '16px' }}>
                    <div>
                      <label className="zr-label">Email</label>
                      <input className="zr-input" placeholder="exemplo@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    {isPasswordAuthRole && (
                      <div>
                        <label className="zr-label">Palavra-passe</label>
                        <input className="zr-input" type="password" placeholder="A tua palavra-passe" value={password} onChange={e => setPassword(e.target.value)} />
                      </div>
                    )}
                    {!isPasswordAuthRole && (
                      <p className="zr-copy">
                        Os passageiros entram com link mágico enviado por email.
                      </p>
                    )}
                    {isPasswordAuthRole ? (
                      <button onClick={handleSignIn} disabled={loading} className="zr-button zr-button--block">Entrar</button>
                    ) : (
                      <button onClick={handleSendMagicLink} disabled={loading} className="zr-button zr-button--block">Enviar link mágico</button>
                    )}

                    <div className="relative flex items-center py-2">
                      <div className="flex-grow border-t border-[#333]"></div>
                      <span className="flex-shrink-0 mx-4 text-[#888] text-sm">ou</span>
                      <div className="flex-grow border-t border-[#333]"></div>
                    </div>

                    <button 
                      onClick={() => handleGoogleAuth(authRole || UserRole.PASSENGER)} 
                      disabled={loading} 
                      className="zr-button zr-button--secondary zr-button--block flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#1A1A1A', color: 'white', border: '1px solid #333' }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Continuar com Google
                    </button>

                    <button onClick={() => switchScreen('reset')} className="zr-button zr-button--ghost zr-button--block">
                      Redefinir password
                    </button>
                  </div>
                </section>
              )}

              {screen === 'signup' && (
                <section>
                  <p className="zr-label">Criar conta como</p>
                  <div className="zr-role-grid">
                    <button onClick={() => setRole(UserRole.PASSENGER)} className={`zr-role-card ${role === UserRole.PASSENGER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">person</span> Passageiro
                    </button>
                    <button onClick={() => setRole(UserRole.DRIVER)} className={`zr-role-card ${role === UserRole.DRIVER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">two_wheeler</span> Motorista
                    </button>
                    <button onClick={() => setRole(UserRole.FLEET_OWNER)} className={`zr-role-card ${role === UserRole.FLEET_OWNER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">apartment</span> Frota
                    </button>
                  </div>
                  <div className="zr-stack" style={{ marginTop: '16px' }}>
                    <div>
                      <label className="zr-label">Nome completo</label>
                      <input className="zr-input" placeholder="Mario Bento" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div>
                      <label className="zr-label">Email</label>
                      <input className="zr-input" placeholder="mario@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    {isPasswordRole && (
                      <div>
                        <label className="zr-label">Palavra-passe</label>
                        <input className="zr-input" type="password" placeholder="Mínimo de 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} />
                      </div>
                    )}
                    {!isPasswordRole && (
                      <p className="zr-copy">
                        A tua conta de passageiro será criada e receberás um link mágico.
                      </p>
                    )}
                    <button onClick={handleSignUp} disabled={loading} className="zr-button zr-button--block">Criar conta</button>

                    <div className="relative flex items-center py-2">
                      <div className="flex-grow border-t border-[#333]"></div>
                      <span className="flex-shrink-0 mx-4 text-[#888] text-sm">ou</span>
                      <div className="flex-grow border-t border-[#333]"></div>
                    </div>

                    <button 
                      onClick={() => handleGoogleAuth(role)} 
                      disabled={loading} 
                      className="zr-button zr-button--secondary zr-button--block flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#1A1A1A', color: 'white', border: '1px solid #333' }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Continuar com Google
                    </button>
                  </div>
                </section>
              )}

              {screen === 'forgot' && (
                <section>
                  <div className="zr-stack">
                    <div>
                      <label className="zr-label">Email de recuperação</label>
                      <input className="zr-input" placeholder="exemplo@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <p className="zr-copy">
                      Iremos enviar um link para definires uma nova palavra-passe. Apenas para Motoristas e Frotas.
                    </p>
                    <button onClick={handleForgotPassword} disabled={loading} className="zr-button zr-button--block">Enviar recuperação</button>
                  </div>
                </section>
              )}

              {screen === 'reset' && (
                <section>
                  <div className="zr-stack">
                    <div>
                      <label className="zr-label">Nova palavra-passe</label>
                      <input className="zr-input" type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    <div>
                      <label className="zr-label">Confirmar palavra-passe</label>
                      <input className="zr-input" type="password" placeholder="Repete a palavra-passe" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                    </div>
                    <button onClick={handleResetPassword} disabled={loading} className="zr-button zr-button--block">Atualizar password</button>
                  </div>
                </section>
              )}

            </div>
          </section>
        </main>
      </div>
    </div>
  );
};





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
