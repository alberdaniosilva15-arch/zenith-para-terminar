import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { kazeSpeak } from '../lib/kazeVoice';

const LOCAL_KAZE_URL = 'http://127.0.0.1:3847';

export default function KazePanel() {
  const [messages, setMessages] = useState([
    { role: 'kaze', content: 'KAZE Core online. Como posso ajudar?' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [plan, setPlan] = useState(null);
  const [agentOnline, setAgentOnline] = useState(null);
  const [hermesStatus, setHermesStatus] = useState(null);
  const [lastAutoSteps, setLastAutoSteps] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (role, content, extra = {}) => {
    setMessages((prev) => [
      ...prev,
      { role, content, timestamp: new Date().toISOString(), ...extra },
    ]);
  };

  const getFreshToken = async () => {
    try {
      const refreshed = await supabase.auth.refreshSession();
      const refreshedToken = refreshed.data?.session?.access_token;
      if (refreshedToken) {
        return refreshedToken;
      }
    } catch (error) {
      console.warn('[KazePanel] refreshSession falhou:', error);
    }

    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  };

  const sendToKaze = async (command, { confirmed = false, forcedMode } = {}) => {
    const token = await getFreshToken();
    if (!token) {
      addMessage('kaze', '⚠️ Sessão expirada. Faz login novamente.');
      return;
    }

    setLoading(true);
    try {
      const isDev = import.meta.env.DEV;
      const mode = forcedMode ?? (autoMode ? 'auto' : 'smart');
      const localPath = mode === 'auto' ? '/auto-operate' : '/command';
      const url = isDev
        ? `${LOCAL_KAZE_URL}${localPath}`
        : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kaze`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          command,
          confirmed,
          mode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Kaze ${response.status}`);
      }

      if (data.requiresConfirmation) {
        setPendingConfirm({ command, forcedMode: mode });
        setPlan(data.plan);
        const planText = data.plan?.steps?.join(' → ') || data.action;
        addMessage(
          'kaze',
          `⚠️ Acção crítica detectada.\n\nPlano: ${planText}\n\nSimulação: ${data.simulation ?? ''}\n\nResponde "sim" para confirmar ou "não" para cancelar.`,
          { route: data.route, routeReason: data.routeReason },
        );
        return;
      }

      setPlan(data.plan ?? null);
      setLastAutoSteps(Array.isArray(data.steps) ? data.steps : []);
      addMessage('kaze', data.response ?? data.error ?? 'Sem resposta.', {
        toolsUsed: data.toolsUsed,
        route: data.route,
        routeReason: data.routeReason,
        steps: data.steps,
        toolResult: data.toolResult || data.result || null,
      });

      if (voiceEnabled && data.response) {
        await kazeSpeak(data.response, import.meta.env.VITE_ELEVENLABS_API_KEY || null);
      }
    } catch (error) {
      addMessage('kaze', `Erro de ligação: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    const command = input.trim();
    addMessage('user', command);
    setInput('');

    if (pendingConfirm) {
      if (/^(sim|yes|s)$/i.test(command)) {
        const pending = pendingConfirm;
        setPendingConfirm(null);
        setPlan(null);
        await sendToKaze(pending.command, { confirmed: true, forcedMode: pending.forcedMode });
      } else {
        setPendingConfirm(null);
        setPlan(null);
        addMessage('kaze', 'Acção cancelada.');
      }
      return;
    }

    await sendToKaze(command);
  };

  useEffect(() => {
    const checkHealth = async () => {
      try {
        if (!import.meta.env.DEV) {
          setAgentOnline(true);
          setHermesStatus(null);
          return;
        }

        const [agentRes, hermesRes] = await Promise.all([
          fetch(`${LOCAL_KAZE_URL}/status`, { method: 'GET', signal: AbortSignal.timeout(3000) }),
          fetch(`${LOCAL_KAZE_URL}/hermes/status`, { method: 'GET', signal: AbortSignal.timeout(3000) }),
        ]);

        setAgentOnline(agentRes.ok);
        setHermesStatus(hermesRes.ok ? await hermesRes.json() : { running: false, lastError: 'Hermes offline' });
      } catch {
        setAgentOnline(false);
        setHermesStatus({ running: false, lastError: 'Sem ligação ao Hermes' });
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'monospace', background: '#0d0d0d', color: '#e0e0e0' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', color: '#00ff88' }}>⚡ KAZE Core</span>
          <StatusDot
            active={agentOnline}
            label={agentOnline === null ? 'Kaze: a verificar...' : agentOnline ? 'Kaze local online' : 'Kaze local offline'}
          />
          <StatusDot
            active={Boolean(hermesStatus?.running)}
            label={hermesStatus?.running ? 'Hermes online' : `Hermes offline${hermesStatus?.lastError ? ` · ${hermesStatus.lastError}` : ''}`}
            activeColor="#7dd3fc"
            inactiveColor="#f97316"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setAutoMode((value) => !value)}
            style={{
              padding: '6px 10px',
              borderRadius: '999px',
              border: `1px solid ${autoMode ? '#7dd3fc' : '#333'}`,
              background: autoMode ? 'rgba(125,211,252,0.12)' : 'transparent',
              color: autoMode ? '#7dd3fc' : '#999',
              cursor: 'pointer',
              fontSize: '0.78em',
            }}
          >
            {autoMode ? 'Auto-Operate ON' : 'Auto-Operate OFF'}
          </button>
          <button
            onClick={() => setVoiceEnabled((value) => !value)}
            title="Toggle voz"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em' }}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>
        </div>
      </div>

      {plan && (
        <div style={{ padding: '8px 16px', background: '#111', borderBottom: '1px solid #222', fontSize: '0.8em', color: '#a3e635' }}>
          Plano: {plan.steps?.join(' → ')}
        </div>
      )}

      {lastAutoSteps.length > 0 && (
        <div style={{ padding: '8px 16px', background: 'rgba(125,211,252,0.08)', borderBottom: '1px solid #1f2937', fontSize: '0.78em', color: '#cbd5e1' }}>
          Multi-step: {lastAutoSteps.length} iteração(ões) concluída(s).
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '84%',
              background: msg.role === 'user' ? '#1a3a5c' : '#161f16',
              border: `1px solid ${msg.role === 'user' ? '#2a5a8c' : '#2a3f2a'}`,
              padding: '10px 14px',
              borderRadius: '8px',
              whiteSpace: 'pre-wrap',
              fontSize: '0.88em',
              lineHeight: '1.5',
            }}
          >
            {msg.role === 'kaze' && <span style={{ color: '#00ff88', fontWeight: 'bold' }}>KAZE › </span>}
            {msg.content}

            {msg.route && (
              <div style={{ marginTop: '8px', fontSize: '0.74em', color: '#94a3b8' }}>
                Rota: {msg.route}{msg.routeReason ? ` · ${msg.routeReason}` : ''}
              </div>
            )}

            {Array.isArray(msg.steps) && msg.steps.length > 0 && (
              <div style={{ marginTop: '10px', padding: '8px', background: 'rgba(0,0,0,0.24)', borderLeft: '2px solid #7dd3fc', fontSize: '0.78em' }}>
                {msg.steps.map((step, stepIndex) => (
                  <div key={stepIndex} style={{ marginBottom: stepIndex === msg.steps.length - 1 ? 0 : '8px' }}>
                    #{step.iteration} · {step.plan?.executor || 'local'} · {step.plan?.stepCommand || step.plan?.finalResponse}
                  </div>
                ))}
              </div>
            )}

            {msg.toolResult && (
              <div style={{ marginTop: '10px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderLeft: '2px solid #00ff88', fontSize: '0.8em' }}>
                <div style={{ color: '#888', marginBottom: '4px' }}>Resultado:</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(msg.toolResult, null, 2)}</pre>
              </div>
            )}

            {msg.toolsUsed?.length > 0 && (
              <div style={{ fontSize: '0.75em', color: '#555', marginTop: '6px', fontStyle: 'italic' }}>
                🔧 Executado: {msg.toolsUsed.join(', ')}
              </div>
            )}
          </div>
        ))}

        {loading && <div style={{ alignSelf: 'flex-start', color: '#444', fontSize: '0.82em' }}>⏳ processando...</div>}
        <div ref={endRef} />
      </div>

      <div style={{ padding: '12px', borderTop: '1px solid #222', display: 'flex', gap: '8px' }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={pendingConfirm ? 'sim / não' : autoMode ? 'Dá uma missão multi-step ao KAZE...' : 'Diz ao KAZE o que fazer...'}
          disabled={loading}
          style={{ flex: 1, padding: '10px 12px', background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', outline: 'none' }}
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={loading || !input.trim()}
          style={{ padding: '10px 18px', background: autoMode ? '#0284c7' : '#00aa55', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'monospace' }}
        >
          {loading ? '⏳' : '▶'}
        </button>
      </div>
    </div>
  );
}

function StatusDot({ active, label, activeColor = '#00ff88', inactiveColor = '#ff4444' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.76em', color: '#aaa' }} title={label}>
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: active === null ? '#888' : active ? activeColor : inactiveColor,
          boxShadow: active ? `0 0 6px ${activeColor}` : active === false ? `0 0 6px ${inactiveColor}` : 'none',
        }}
      />
      {label}
    </span>
  );
}
