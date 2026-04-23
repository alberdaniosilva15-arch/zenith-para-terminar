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
  status: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  alert:  'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse',
  event:  'bg-primary/10 text-primary border-primary/20',
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
      alert('❌ Não foi possível enviar a mensagem. Verifica a tua ligação e tenta de novo.');
    } else {
      setNewMessage('');
    }
    setSending(false);
  };

  // FIX: UPDATE directo (evita 404 do RPC increment_post_likes)
  const handleConfirm = async (msg: TalkMessage) => {
    const newCount = (msg.confirmations ?? 0) + 1;
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmations: newCount } : m));
    await supabase
      .from('posts')
      .update({ likes: newCount })
      .eq('id', msg.id);
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
        alert(`🎙️ ${msg}`);
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
    <div className="mt-4 bg-surface-container-low border border-outline-variant/20 rounded-[2.5rem] overflow-hidden shadow-sm">

      {/* Header */}
      <div className="bg-[#0A0A0A] px-6 py-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📻</span>
          <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">
            RideTalk · {zone}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[8px] text-white/50 font-black uppercase">LIVE</span>
        </div>
      </div>

      {/* Filtros de categoria */}
      <div className="flex gap-2 p-4 bg-surface-container-lowest/50 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
        {(['all', 'status', 'alert', 'event'] as Category[]).map(cat => {
          const counts = cat === 'all'
            ? messages.length
            : messages.filter(m => m.type === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`px-4 py-2 rounded-full text-[9px] font-black uppercase border transition-all shrink-0 flex items-center gap-1.5 ${
                activeCat === cat
                  ? cat === 'alert'
                    ? 'bg-red-600 text-white border-red-600'
                    : cat === 'event'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface-container-highest text-white border-outline-variant shadow-lg'
                  : 'bg-surface-container-low text-on-surface-variant/70 border-outline-variant/20 hover:border-outline-variant/50'
              }`}
            >
              {cat === 'alert' ? '🚨' : cat === 'event' ? '📍' : cat === 'status' ? '💬' : '📻'}
              {CAT_LABELS[cat]}
              {counts > 0 && (
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black ${
                  activeCat === cat ? 'bg-white/20' : 'bg-outline/20'
                }`}>
                  {counts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed de mensagens */}
      <div className="p-4 max-h-72 overflow-y-auto no-scrollbar space-y-3 bg-surface-container-low">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">A carregar...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">
              {activeCat === 'alert' ? '🚨' : activeCat === 'event' ? '📍' : '📻'}
            </p>
            <p className="text-[10px] font-black text-on-surface-variant/50 uppercase tracking-widest">
              {activeCat === 'all'
                ? 'Nenhuma publicação ainda'
                : `Sem ${CAT_LABELS[activeCat].toLowerCase()}s na zona ${zone}`}
            </p>
            <p className="text-[9px] text-on-surface-variant/40 font-bold mt-1">
              Sê o primeiro a partilhar!
            </p>
          </div>
        ) : (
          filtered.map(msg => (
            <div
              key={msg.id}
              className="bg-surface-container-lowest p-4 rounded-[1.5rem] border border-outline-variant/15 transition-all hover:border-outline-variant/40"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-black text-primary shrink-0">
                    {msg.senderName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[9px] font-black text-on-surface">
                    {msg.senderName}
                  </span>
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${TYPE_COLORS[msg.type] ?? TYPE_COLORS.status}`}>
                    {TYPE_ICONS[msg.type]} {msg.type === 'alert' ? 'Alerta' : msg.type === 'event' ? 'Evento' : 'Status'}
                  </span>
                  {msg.zone && msg.zone !== 'Geral' && (
                    <span className="text-[8px] font-bold text-on-surface-variant/60">📍 {msg.zone}</span>
                  )}
                </div>
                <span className="text-[8px] text-on-surface-variant/50 font-bold shrink-0">{timeAgo(msg.timestamp)}</span>
              </div>

              <p className="text-[11px] font-bold text-on-surface leading-relaxed mt-2 mb-3">
                {msg.text}
              </p>

              <button
                onClick={() => handleConfirm(msg)}
                className="flex items-center gap-1.5 text-[9px] font-black text-on-surface-variant/60 hover:text-primary transition-colors"
              >
                <span>👍</span>
                <span>Confirmar · {msg.confirmations}</span>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Input de envio */}
      <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low">
        {/* Selector de tipo */}
        <div className="flex gap-2 mb-3">
          {(['status', 'alert', 'event'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveCat(t)}
              className={`px-3 py-1.5 rounded-full text-[8px] font-black uppercase border transition-all flex items-center gap-1 ${
                activeCat === t
                  ? t === 'alert' ? 'bg-red-600 text-white border-red-600'
                  : t === 'event' ? 'bg-primary text-white border-primary'
                  : 'bg-surface-container-highest text-white border-outline-variant'
                  : 'bg-transparent text-on-surface-variant/60 border-outline-variant/20'
              }`}
            >
              {TYPE_ICONS[t]} {CAT_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleVoiceRecord}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg transition-all shadow-sm ${
              isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-surface-container-lowest text-outline border border-outline-variant/20'
            }`}
            aria-label="Gravar voz"
          >
            {isRecording ? '⏹️' : '🎙️'}
          </button>

          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeCat === 'alert' ? '🚨 Reportar alerta de trânsito...' :
              activeCat === 'event' ? '📍 Partilhar evento em Luanda...' :
              '💬 Partilhar o teu status...'
            }
            className="flex-1 bg-surface-container-lowest border border-outline-variant/20 text-[11px] font-bold px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-primary/40 transition-all text-on-surface placeholder:text-on-surface-variant/30"
          />

          <button
            onClick={handleSend}
            disabled={sending || !newMessage.trim() || !profile}
            className="bg-[#0A0A0A] text-white px-5 rounded-2xl text-[10px] font-black shadow-lg disabled:opacity-40 active:scale-95 transition-all hover:bg-primary"
          >
            {sending ? '...' : 'ENVIAR'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RideTalk;
