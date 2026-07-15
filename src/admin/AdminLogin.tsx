import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

const AUTH_REDIRECT_STORAGE_KEY = 'auth_redirect_intent';

function sanitizeRedirectTarget(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//')) return null;
  if (candidate.startsWith('/login')) return null;
  return candidate;
}

function readNextTarget() {
  if (typeof window === 'undefined') return '/admin/kaze';
  const searchTarget = sanitizeRedirectTarget(new URLSearchParams(window.location.search).get('next'));
  const storedTarget = sanitizeRedirectTarget(window.localStorage.getItem(AUTH_REDIRECT_STORAGE_KEY));
  return searchTarget ?? storedTarget ?? '/admin/kaze';
}

export default function AdminLogin() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextTarget = useMemo(() => readNextTarget(), []);

  const persistNextTarget = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, nextTarget);
  };

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Preenche email e palavra-passe de admin.');
      return;
    }

    persistNextTarget();
    setLoading(true);
    setError(null);
    const authError = await signIn(email.trim(), password);
    setLoading(false);
    if (authError) {
      setError(authError.message);
    }
  };

  const handleGoogleSignIn = async () => {
    persistNextTarget();
    setLoading(true);
    setError(null);
    const authError = await signInWithGoogle(UserRole.ADMIN, nextTarget);
    setLoading(false);
    if (authError) {
      setError(authError.message);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at 50% 25%, rgba(43,255,226,0.14), transparent 22%), linear-gradient(160deg, #02060d 0%, #06111a 45%, #03070d 100%)',
        color: '#edfffb',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: 'min(100%, 480px)',
          borderRadius: 28,
          border: '1px solid rgba(87,255,222,0.14)',
          background: 'rgba(5, 15, 24, 0.9)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4), inset 0 0 60px rgba(0,194,255,0.06)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '22px 24px', borderBottom: '1px solid rgba(87,255,222,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                display: 'grid',
                placeItems: 'center',
                background: 'linear-gradient(145deg, rgba(18,163,255,0.22), rgba(76,245,216,0.2))',
                border: '1px solid rgba(87,255,222,0.24)',
              }}
            >
              <ShieldCheck size={22} color="#57ffe3" />
            </div>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#86efe2' }}>Zenith CRM</div>
              <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>Admin Core</div>
            </div>
          </div>
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, color: 'rgba(212,255,248,0.72)' }}>
            Entrada dedicada do CRM administrativo. Aqui abres diretamente o cockpit do Kaze Core e operações.
          </p>
        </div>

        <div style={{ padding: 24, display: 'grid', gap: 16 }}>
          {error ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 16,
                border: '1px solid rgba(255,120,120,0.2)',
                background: 'rgba(60, 12, 20, 0.55)',
                color: '#fecaca',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#9deee3' }}>Email admin</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@zenithride.ao"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#9deee3' }}>Palavra-passe</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="A tua palavra-passe de admin"
              style={inputStyle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handlePasswordSignIn();
                }
              }}
            />
          </label>

          <button onClick={() => void handlePasswordSignIn()} disabled={loading} style={primaryButtonStyle}>
            {loading ? 'A entrar...' : 'Entrar no CRM'}
          </button>

          <div style={{ position: 'relative', textAlign: 'center', color: '#7ca29b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            <span style={{ background: 'rgba(5, 15, 24, 0.9)', padding: '0 10px', position: 'relative', zIndex: 1 }}>ou</span>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(87,255,222,0.12)' }} />
          </div>

          <button onClick={() => void handleGoogleSignIn()} disabled={loading} style={secondaryButtonStyle}>
            <Sparkles size={18} />
            <span>Continuar com Google Admin</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  borderRadius: 18,
  border: '1px solid rgba(87,255,222,0.14)',
  background: 'rgba(3, 12, 19, 0.92)',
  color: '#f0fffd',
  padding: '14px 16px',
  outline: 'none',
  fontSize: 15,
} satisfies CSSProperties;

const primaryButtonStyle = {
  width: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  borderRadius: 18,
  border: '1px solid rgba(87,255,222,0.18)',
  background: 'linear-gradient(145deg, rgba(24,169,255,0.28), rgba(76,245,216,0.24))',
  color: '#f0fffd',
  padding: '15px 18px',
  fontWeight: 700,
  cursor: 'pointer',
} satisfies CSSProperties;

const secondaryButtonStyle = {
  width: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  borderRadius: 18,
  border: '1px solid rgba(87,255,222,0.14)',
  background: 'rgba(7, 21, 31, 0.92)',
  color: '#dffcf8',
  padding: '15px 18px',
  fontWeight: 700,
  cursor: 'pointer',
} satisfies CSSProperties;
