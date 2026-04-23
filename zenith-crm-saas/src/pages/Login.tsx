import React, { useState } from 'react';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { Mail, KeyRound, ArrowRight, CheckCircle2 } from 'lucide-react';

const Login: React.FC = () => {
  const { signIn, signInWithGoogle, signInWithMagicLink, error } = useAdminAuth();
  
  const [view, setView]          = useState<'login' | 'magic'>('login');
  const [email, setEmail]        = useState('');
  const [password, setPassword]  = useState('');
  const [loading, setLoading]    = useState(false);
  const [successMsg, setSuccess] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess('');
    setLocalError('');
    
    if (view === 'login') {
      const result = await signIn(email, password);
      if (result.error) {
        setLocalError(result.error);
      }
    } else if (view === 'magic') {
      const ok = await signInWithMagicLink(email);
      if (ok) setSuccess('Verifica a tua caixa de e-mail para entrares com o link mágico!');
    }
    
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in" style={{ width: '100%', maxWidth: '420px', padding: '32px' }}>
        <div className="login-logo" style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div className="login-logo-title" style={{ fontSize: '28px' }}>⚡ ZENITH</div>
          <div className="login-logo-sub" style={{ fontSize: '12px' }}>CRM · Painel de Controlo</div>
        </div>

        {/* Mensagem Sucesso */}
        {successMsg && (
          <div style={{ background: 'rgba(0, 230, 118, 0.1)', border: '1px solid rgba(0, 230, 118, 0.2)', borderRadius: '8px', padding: '12px', fontSize: '13px', color: 'var(--green)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} /> {successMsg}
          </div>
        )}

        {/* Mensagem Erro */}
        {(error || localError) && (
          <div style={{ background: 'rgba(255, 68, 68, 0.1)', border: '1px solid rgba(255, 68, 68, 0.2)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: 'var(--red)', marginBottom: '16px' }}>
            {error || localError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button type="button" className={`btn ${view === 'login' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, fontSize: '12px' }} onClick={() => setView('login')}>Entrar</button>
          <button type="button" className={`btn ${view === 'magic' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, fontSize: '12px' }} onClick={() => setView('magic')}>Link Mágico</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Email */}
          <div>
            <label className="input-label">Email de Administrador</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text3)' }} />
              <input type="email" className="input" placeholder="admin@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" style={{ paddingLeft: '40px' }} />
            </div>
          </div>

          {/* Password */}
          {view === 'login' && (
            <div>
              <label className="input-label">Senha Única</label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text3)' }} />
                <input type="password" className="input" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" style={{ paddingLeft: '40px' }} />
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading} style={{ marginTop: '8px', justifyContent: 'center', gap: '8px' }}>
            {loading ? <span className="spinner" /> : 
              view === 'login' ? 'Aceder ao Painel' : 
              'Enviar Request Link'}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        {view === 'login' && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0', color: 'var(--text3)', fontSize: '11px', textTransform: 'uppercase' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              <span style={{ padding: '0 12px' }}>OU</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            </div>

            <button type="button" className="btn btn-ghost w-full" style={{ justifyContent: 'center', gap: '8px', border: '1px solid var(--border)', background: 'var(--bg3)' }} onClick={handleGoogle} disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar com a Google
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default Login;
