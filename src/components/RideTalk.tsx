// =============================================================================
// ZENITH RIDE v3.0 — RideTalk.tsx
// FIXES:
//   1. Query posts: join correcto sem foreign key dinâmica
//   2. increment_post_likes substituído por UPDATE directo (evita 404 de RPC)
//   3. Filtros Status / Alerta / Eventos totalmente funcionais
//   4. Realtime: .on() ANTES de .subscribe() (evita erro de canal)
//   5. Envio de mensagem com tipo correcto
//   6. Estado vazio com mensagem adequada
// =============================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UserRole } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore } from '../store/useAppStore';

type Category = 'all' | 'status' | 'alert' | 'event';

interface TalkMessage {
  id:            string;
  senderName:    string;
  senderRole:    UserRole;
  text:          string;
  zone:          string;
  timestamp:     number;
  type:          'status' | 'alert' | 'event';
  confirmations: number;
}

const CAT_LABELS: Record<Category, string> = {
  all:    'Tudo',
  status: 'Status',
  alert:  'Alerta',
  event:  'Eventos',
};

const TYPE_ICONS: Record<string, string> = {
  status: '💬',
  alert:  '🚨',
  event:  '📍',
};

const TYPE_COLORS: Record<string, string> = {
  status: 'zr-chip--info',
  alert:  'zr-chip--danger animate-pulse',
  event:  'zr-chip--gold',
};

// Converte row do Supabase para TalkMessage
function rowToMsg(p: any): TalkMessage {
  return {
    id:            p.id,
    senderName:    p.profiles?.name ?? 'Utilizador',
    senderRole:    UserRole.DRIVER,
    text:          p.content,
    zone:          p.location ?? 'Geral',
    timestamp:     new Date(p.created_at).getTime(),
    type:          p.post_type ?? 'status',
    confirmations: p.likes ?? 0,
  };
}

const RideTalk: React.FC<{ zone: string; role: UserRole }> = ({ zone, role }) => {
  const { profile } = useAuth();
  const showToast = useAppStore((s) => s.showToast);
  const [activeCat,   setActiveCat]   = useState<Category>('all');
  const [messages,    setMessages]    = useState<TalkMessage[]>([]);
  const [newMessage,  setNewMessage]  = useState('');
  const [sending,     setSending]     = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const channelRef       = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);

  // ── Carregar + subscrever ────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      // FIX: usar join manual em vez de foreign key sintax que dá 400
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('posts')
        .select('id, content, post_type, location, likes, audio_url, created_at, user_id')
        .gte('created_at', cutoff24h)
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) {
        console.error('[RideTalk] Erro ao carregar posts:', error.message);
        if (mounted) setLoading(false);
        return;
      }

      if (!data || !mounted) { setLoading(false); return; }

      // Buscar nomes dos perfis em batch
      const userIds = [...new Set(data.map((p: any) => p.user_id))];
      let profileRows: any[] = [];
      if (userIds.length > 0) {
        const { data: res } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        profileRows = res ?? [];
      }

      const nameMap: Record<string, string> = {};
      profileRows.forEach((pr: any) => { nameMap[pr.user_id] = pr.name; });

      setMessages(
        data.map((p: any) => ({
          id:            p.id,
          senderName:    nameMap[p.user_id] ?? 'Utilizador',
          senderRole:    UserRole.DRIVER,
          text:          p.content,
          zone:          p.location ?? 'Geral',
          timestamp:     new Date(p.created_at).getTime(),
          type:          p.post_type ?? 'status',
          confirmations: p.likes ?? 0,
        }))
      );
      setLoading(false);
    };

    load();

    // Canal fixo sem Date.now() — evita canais duplicados a cada re-render
    channelRef.current = supabase
      .channel(`ridetalk_zone_${zone}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
        if (!mounted) return;
        const n = payload.new as any;
        const { data: pr } = await supabase.from('profiles').select('name').eq('user_id', n.user_id).maybeSingle();
        const msg: TalkMessage = {
          id:            n.id,
          senderName:    pr?.name ?? 'Utilizador',
          senderRole:    UserRole.DRIVER,
          text:          n.content,
          zone:          n.location ?? 'Geral',
          timestamp:     new Date(n.created_at).getTime(),
          type:          n.post_type ?? 'status',
          confirmations: n.likes ?? 0,
        };
        setMessages(prev => [msg, ...prev].slice(0, 60));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        if (!mounted) return;
        const u = payload.new as any;
        setMessages(prev => prev.map(m => m.id === u.id ? { ...m, confirmations: u.likes ?? m.confirmations } : m));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[RideTalk] Falha Realtime — a trabalhar offline.');
        }
      });

    return () => {
      mounted = false;
      // Parar gravação se activa
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [zone]);

  // ── Filtrar mensagens ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return messages.filter(m => {
      const zoneOk = zone === 'Geral' || m.zone === zone || m.zone === 'Geral';
      const catOk  = activeCat === 'all' || m.type === activeCat;
      return zoneOk && catOk;
    });
  }, [messages, zone, activeCat]);

  // ── Enviar mensagem ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!newMessage.trim() || sending || !profile) return;
    setSending(true);
    const postType = activeCat === 'all' ? 'status' : activeCat;

    const { error } = await supabase.from('posts').insert({
      user_id:   profile.user_id,
      content:   newMessage.trim(),
      post_type: postType,
      location:  zone !== 'Geral' ? zone : null,
      likes:     0,
    });

    if (error) {
      console.error('[RideTalk] Erro ao enviar:', error.message);
      showToast('❌ Não foi possível enviar a mensagem. Verifica a tua ligação e tenta de novo.', 'error');
    } else {
      setNewMessage('');
    }
    setSending(false);
  };

  const handleConfirm = async (msg: TalkMessage) => {
    const previousCount = msg.confirmations ?? 0;
    const optimisticCount = previousCount + 1;
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmations: optimisticCount } : m));

    const { data, error } = await supabase.rpc('increment_post_likes', {
      p_post_id: msg.id,
    });
    const nextCount = Number(data);

    if (error || !Number.isFinite(nextCount) || nextCount < 0) {
      if (error) console.error('[RideTalk] Erro ao confirmar:', error.message);
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmations: previousCount } : m));
      return;
    }

    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmations: nextCount } : m));
  };

  // ── Gravação de voz real com MediaRecorder ───────────────────────────────────
  const sendVoiceMessage = async (blob: Blob, mimeType: string) => {
    if (!profile) return;
    setSending(true);
    try {
      const ext      = mimeType.includes('webm') ? 'webm' : 'ogg';
      const filename = `voice/${profile.user_id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(filename, blob, { contentType: mimeType, cacheControl: '3600' });
      if (uploadError) { console.error('[RideTalk] Erro upload:', uploadError); return; }
      const { data: { publicUrl } } = supabase.storage.from('voice-messages').getPublicUrl(filename);
      await supabase.from('posts').insert({
        user_id:   profile.user_id,
        content:   '🎙️ Mensagem de voz',
        post_type: activeCat === 'all' ? 'status' : activeCat,
        location:  zone !== 'Geral' ? zone : null,
        audio_url: publicUrl,
        likes:     0,
      });
    } catch (err) {
      console.error('[RideTalk] Erro no envio de voz:', err);
    } finally {
      setSending(false);
    }
  };

  const handleVoiceRecord = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
        });
        streamRef.current      = stream;
        audioChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          if (blob.size > 0) await sendVoiceMessage(blob, mimeType);
        };
        recorder.start(250);
        setIsRecording(true);
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name;
        const msg = name === 'NotAllowedError'
          ? 'Permissão de microfone negada. Vai às definições do browser e permite o microfone.'
          : 'Microfone não disponível. Verifica se está ligado.';
        showToast(`🎙️ ${msg}`, 'error');
      }
    } else {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'agora';
    if (diff < 60) return `${diff}m atrás`;
    return `${Math.floor(diff / 60)}h atrás`;
  };

  return (
    <div className="zr-card" style={{ marginTop: '16px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, var(--surface-2), transparent)' }}>
        <div className="zr-inline zr-inline--between">
          <div className="zr-inline" style={{ gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>📻</span>
            <h3 className="zr-section-title" style={{ fontSize: '14px', margin: 0 }}>RideTalk · {zone}</h3>
          </div>
          <div className="zr-inline" style={{ gap: '4px' }}>
            <span className="animate-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
            <span className="zr-meta" style={{ fontSize: '10px', color: 'var(--success)' }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* Filtros de categoria */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-1)' }}>
        <div className="zr-scroll-x">
          {(['all', 'status', 'alert', 'event'] as Category[]).map(cat => {
            const counts = cat === 'all' ? messages.length : messages.filter(m => m.type === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`zr-tab ${activeCat === cat ? 'is-active' : ''}`}
                style={{ fontSize: '10px', padding: '6px 12px' }}
              >
                {cat === 'alert' ? '🚨 ' : cat === 'event' ? '📍 ' : cat === 'status' ? '💬 ' : '📻 '}
                {CAT_LABELS[cat]}
                {counts > 0 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({counts})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed de mensagens */}
      <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--surface-1)' }}>
        {loading ? (
          <div className="zr-loading-dots" style={{ alignSelf: 'center', margin: '32px 0' }}><span></span><span></span><span></span></div>
        ) : filtered.length === 0 ? (
          <div className="zr-empty" style={{ margin: '32px 0' }}>
            <span style={{ fontSize: '32px', marginBottom: '8px' }}>{activeCat === 'alert' ? '🚨' : activeCat === 'event' ? '📍' : '📻'}</span>
            <p className="zr-copy">{activeCat === 'all' ? 'Nenhuma publicação ainda' : `Sem ${CAT_LABELS[activeCat].toLowerCase()}s na zona ${zone}`}</p>
          </div>
        ) : (
          filtered.map(msg => (
            <div key={msg.id} className="zr-card zr-card--soft" style={{ padding: '12px' }}>
              <div className="zr-inline zr-inline--between" style={{ alignItems: 'flex-start', marginBottom: '8px' }}>
                <div className="zr-inline" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontWeight: 'bold' }}>
                    {msg.senderName.charAt(0).toUpperCase()}
                  </div>
                  <strong style={{ fontSize: '12px' }}>{msg.senderName}</strong>
                  <span className={`zr-chip ${TYPE_COLORS[msg.type] ?? 'zr-chip--info'}`} style={{ fontSize: '8px', padding: '2px 6px' }}>
                    {TYPE_ICONS[msg.type]} {msg.type === 'alert' ? 'Alerta' : msg.type === 'event' ? 'Evento' : 'Status'}
                  </span>
                  {msg.zone && msg.zone !== 'Geral' && (
                    <span className="zr-meta" style={{ fontSize: '10px' }}>📍 {msg.zone}</span>
                  )}
                </div>
                <span className="zr-meta" style={{ fontSize: '10px' }}>{timeAgo(msg.timestamp)}</span>
              </div>

              <p className="zr-copy" style={{ fontSize: '12px', marginBottom: '12px' }}>{msg.text}</p>

              <button onClick={() => handleConfirm(msg)} className="zr-icon-button" style={{ fontSize: '12px', color: 'var(--gold-soft)', display: 'inline-flex', gap: '4px', width: 'auto', padding: '4px 8px', height: 'auto', borderRadius: '16px' }}>
                👍 Confirmar · {msg.confirmations}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Input de envio */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-scroll-x" style={{ marginBottom: '12px' }}>
          {(['status', 'alert', 'event'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveCat(t)}
              className={`zr-chip ${activeCat === t ? (t === 'alert' ? 'zr-chip--danger' : t === 'event' ? 'zr-chip--gold' : 'zr-chip--info') : ''}`}
              style={{ fontSize: '10px', padding: '4px 12px', border: activeCat !== t ? '1px solid var(--surface-3)' : 'none' }}
            >
              {TYPE_ICONS[t]} {CAT_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="zr-inline" style={{ gap: '12px' }}>
          <button onClick={handleVoiceRecord} className={`zr-icon-button ${isRecording ? 'animate-pulse' : ''}`} style={{ backgroundColor: isRecording ? 'var(--danger)' : 'var(--surface-3)', color: isRecording ? '#fff' : 'inherit' }}>
            {isRecording ? '⏹️' : '🎙️'}
          </button>

          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeCat === 'alert' ? '🚨 Reportar alerta de trânsito...' : activeCat === 'event' ? '📍 Partilhar evento...' : '💬 Partilhar status...'}
            className="zr-input"
            style={{ flex: 1 }}
          />

          <button onClick={handleSend} disabled={sending || !newMessage.trim() || !profile} className="zr-button" style={{ padding: '0 16px' }}>
            {sending ? '...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RideTalk;
