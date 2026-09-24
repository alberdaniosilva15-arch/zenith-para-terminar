// =============================================================================
// ZENITH RIDE v3.4 — RideChat.tsx (Chat Fiável e Idempotente)
// Chat em tempo real entre motorista e passageiro com persistência e Realtime
// ✅ Idempotência com client_id (UUID único por mensagem)
// ✅ Broadcast APENAS após persistência com sucesso (sem mensagens fantasma)
// ✅ Identificação de remetente em cache (sem roundtrip auth a cada envio)
// ✅ Tratamento de erro visível na UI com retry sem duplicar
// ✅ Deduplicação exata por ID/client_id (permite mensagens idênticas consecutivas)
// ✅ Polling inteligente condicional (só em modo degradado/foco)
// =============================================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import KazeCreditsBadge from './KazeCreditsBadge';

interface Msg {
  id: string;
  client_id?: string;
  sender_id: string;
  text: string;
  created_at: string;
  state?: 'sending' | 'sent' | 'failed';
}

interface RideChatProps {
  rideId: string;
  myId: string;
  peerName: string;
  phonePrivacyMode?: boolean;
}

export default function RideChat({
  rideId,
  myId,
  peerName,
  phonePrivacyMode = false,
}: RideChatProps) {
  const { session } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const lastSeenAtRef = useRef<string>(new Date(0).toISOString());
  const channelRef = useRef<any>(null);
  const isSubscribedRef = useRef(false);

  const quickReplies = [
    'Estou a caminho',
    'Já cheguei ao local',
    'Aguarda 2 min por favor',
    'Ok, perfeito!',
    'Onde estás exactamente?',
  ];

  // Identificação do remetente sem chamada de rede extra
  const senderId = session?.user?.id || myId;

  useEffect(() => {
    openRef.current = open;
    if (open) {
      setUnread(0);
      void fetchMessages();
    }
  }, [open]);

  const fetchMessages = useCallback(async (onlyIncremental = false) => {
    if (!rideId) return;
    try {
      let query = supabase
        .from('ride_messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });

      if (onlyIncremental && lastSeenAtRef.current) {
        query = query.gt('created_at', lastSeenAtRef.current);
      }

      const { data, error } = await query;

      if (!error && data && data.length > 0) {
        setMsgs((prev) => {
          let updated = [...prev];
          for (const item of data) {
            const m = item as Msg;
            const idx = updated.findIndex(
              (x) => (m.client_id && x.client_id === m.client_id) || x.id === m.id
            );
            const msgWithState: Msg = { ...m, state: 'sent' };
            if (idx === -1) {
              updated.push(msgWithState);
            } else {
              updated[idx] = { ...updated[idx], ...msgWithState };
            }
          }
          updated.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const lastItem = updated[updated.length - 1];
          if (lastItem) {
            lastSeenAtRef.current = lastItem.created_at;
          }
          return updated;
        });
      }
    } catch (err) {
      console.warn('[RideChat] Erro ao carregar mensagens:', err);
    }
  }, [rideId]);

  useEffect(() => {
    if (!rideId) return;

    let active = true;
    void fetchMessages(false);

    const handleIncomingMsg = (nextMsg: Msg) => {
      if (!nextMsg || !nextMsg.id || !active) return;

      setMsgs((prev) => {
        const i = prev.findIndex(
          (x) => (nextMsg.client_id && x.client_id === nextMsg.client_id) || x.id === nextMsg.id
        );
        const confirmedMsg: Msg = { ...nextMsg, state: 'sent' };
        if (i === -1) {
          const next: Msg[] = [...prev, confirmedMsg];
          next.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const lastMsg = next[next.length - 1];
          if (lastMsg) lastSeenAtRef.current = lastMsg.created_at;
          return next;
        }
        const next: Msg[] = [...prev];
        next[i] = { ...next[i], ...confirmedMsg };
        const lastMsg = next[next.length - 1];
        if (lastMsg) lastSeenAtRef.current = lastMsg.created_at;
        return next;
      });

      if (nextMsg.sender_id !== senderId && !openRef.current) {
        setUnread((count) => count + 1);
      }
    };

    // Canal Realtime WebSocket (Broadcast com tópico restrito + Postgres Changes)
    const channel = supabase
      .channel(`ride_chat_${rideId}`)
      .on('broadcast', { event: 'NEW_MESSAGE' }, (payload) => {
        if (payload.payload) {
          handleIncomingMsg(payload.payload as Msg);
        }
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_messages',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          handleIncomingMsg(payload.new as Msg);
        }
      )
      .subscribe((status) => {
        isSubscribedRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = channel;

    // Polling inteligente: apenas em modo degradado ou a cada 10s se realtime estiver inactivo
    const pollInterval = setInterval(() => {
      if (active && (!isSubscribedRef.current || document.visibilityState === 'visible')) {
        void fetchMessages(true);
      }
    }, 8000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && active) {
        void fetchMessages(true);
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(pollInterval);
      window.removeEventListener('visibilitychange', handleVisibility);
      channelRef.current = null;
      isSubscribedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [fetchMessages, rideId, senderId]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, open]);

  const send = async (msgToSend: string, existingClientId?: string) => {
    const value = msgToSend.trim();
    if (!value || !rideId || !senderId) return;

    const clientId = existingClientId || crypto.randomUUID();
    const tempId = `client-${clientId}`;

    if (!existingClientId) {
      const optimisticMsg: Msg = {
        id: tempId,
        client_id: clientId,
        sender_id: senderId,
        text: value,
        created_at: new Date().toISOString(),
        state: 'sending',
      };

      setMsgs((prev) => [...prev, optimisticMsg]);
      setText('');
    } else {
      setMsgs((prev) =>
        prev.map((m) =>
          m.client_id === clientId ? { ...m, state: 'sending' } : m
        )
      );
    }

    // 1. Gravar PRIMEIRO na Base de Dados (evita mensagem fantasma)
    try {
      const { data, error } = await supabase
        .from('ride_messages')
        .insert({
          ride_id: rideId,
          sender_id: senderId,
          text: value,
          client_id: clientId,
        })
        .select()
        .single();

      if (error) {
        console.warn('[RideChat] chat_send_failed:', error.code, error.message);
        setMsgs((prev) =>
          prev.map((m) =>
            m.client_id === clientId ? { ...m, state: 'failed' } : m
          )
        );
        return;
      }

      if (data) {
        setMsgs((prev) =>
          prev.map((m) =>
            m.client_id === clientId ? { ...(data as Msg), state: 'sent' } : m
          )
        );
        lastSeenAtRef.current = data.created_at;

        // 2. Broadcast APENAS após gravação confirmada
        try {
          channelRef.current?.send({
            type: 'broadcast',
            event: 'NEW_MESSAGE',
            payload: data,
          });
        } catch (bErr) {
          console.warn('[RideChat] Broadcast notification warning:', bErr);
        }
      }
    } catch (e: any) {
      console.error('[RideChat] Excepção ao enviar:', e);
      setMsgs((prev) =>
        prev.map((m) =>
          m.client_id === clientId ? { ...m, state: 'failed' } : m
        )
      );
    }
  };

  // BOTÃO FECHADO
  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-2xl bg-surface-container border border-primary/20 hover:border-primary/50 text-on-surface font-bold text-xs luxury-transition active:scale-98 shadow-md"
      >
        <span className="material-symbols-outlined text-primary text-lg">chat</span>
        <span>Chat com {peerName || 'Passageiro'}</span>
        {unread > 0 ? (
          <span className="ml-1 bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse shadow-sm">
            {unread} nova{unread > 1 ? 's' : ''}
          </span>
        ) : msgs.length > 0 ? (
          <span className="text-[10px] text-on-surface-variant font-mono">
            ({msgs.length})
          </span>
        ) : null}
      </button>
    );
  }

  // MODAL ABERTO — Modal centrado / bottom sheet ultra-polido
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="w-full sm:max-w-md bg-[#121214] border border-white/10 sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col h-[82vh] sm:h-[580px] overflow-hidden animate-in slide-in-from-bottom-6 duration-300"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 bg-[#18181b] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full golden-gradient flex items-center justify-center font-bold text-black text-sm shadow-md">
              {(peerName || 'P').charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-headline font-bold text-sm text-white">{peerName || 'Passageiro'}</h3>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                <span className="text-[10px] text-primary/80 font-mono">Chat da Corrida</span>
                {phonePrivacyMode && (
                  <span className="text-[9px] text-primary/60">· Protegido</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <KazeCreditsBadge userId={myId} rideId={rideId} />
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all ml-1"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Área de Mensagens */}
        <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-[#0d0d0f]">
          {msgs.length === 0 && (
            <div className="my-auto text-center p-6 space-y-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">forum</span>
              </div>
              <p className="text-white/80 font-bold text-xs">Ainda não há mensagens</p>
              <p className="text-white/40 text-[10px]">Envia uma mensagem para combinar detalhes com {peerName}.</p>
            </div>
          )}
          {msgs.map((msg) => {
            const isMe = msg.sender_id === senderId;
            const isFailed = msg.state === 'failed';
            const isSending = msg.state === 'sending';

            return (
              <div
                key={msg.client_id || msg.id}
                className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    isFailed
                      ? 'bg-red-950/60 text-red-200 border border-red-500/40 rounded-br-xs'
                      : isMe
                        ? 'golden-gradient text-black font-semibold rounded-br-xs shadow-md'
                        : 'bg-white/10 text-white rounded-bl-xs border border-white/5'
                  } ${isSending ? 'opacity-70' : ''}`}
                >
                  {msg.text}
                </div>
                <div className="flex items-center gap-1.5 mt-1 px-1">
                  <span className="text-[9px] text-white/40 font-mono">
                    {new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && isSending && (
                    <span className="text-[9px] text-primary/70 font-mono">· a enviar...</span>
                  )}
                  {isMe && isFailed && (
                    <button
                      onClick={() => void send(msg.text, msg.client_id)}
                      className="text-[9px] text-red-400 font-bold underline hover:text-red-300 transition-colors"
                    >
                      Falhou · Tocar para reenviar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Respostas Rápidas */}
        <div className="px-3 py-2 bg-[#141416] border-t border-white/5 overflow-x-auto flex gap-1.5 no-scrollbar">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => void send(reply)}
              className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-white/80 whitespace-nowrap active:scale-95 transition-all flex-shrink-0"
            >
              {reply}
            </button>
          ))}
        </div>

        {/* Caixa de Entrada de Texto */}
        <div className="p-3 bg-[#18181b] border-t border-white/10 flex items-center gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send(text);
            }}
            placeholder="Escreve uma mensagem..."
            maxLength={500}
            className="flex-1 bg-black/50 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-primary transition-all"
          />
          <button
            onClick={() => void send(text)}
            disabled={!text.trim()}
            className="w-10 h-10 rounded-xl golden-gradient disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-black font-bold shadow-md active:scale-95 transition-all flex-shrink-0"
          >
            <span className="material-symbols-outlined text-lg">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
