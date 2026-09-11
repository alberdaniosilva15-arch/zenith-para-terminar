// =============================================================================
// ZENITH RIDE v3.2 — RideChat.tsx
// Chat em tempo real entre motorista e passageiro com persistência e Realtime
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import KazeCreditsBadge from './KazeCreditsBadge';

interface Msg {
  id: string;
  sender_id: string;
  text: string;
  created_at: string;
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
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);

  const quickReplies = [
    'Estou a caminho',
    'Já cheguei ao local',
    'Aguarda 2 min por favor',
    'Ok, perfeito!',
    'Onde estás exactamente?',
  ];

  useEffect(() => {
    openRef.current = open;
    if (open) {
      setUnread(0);
    }
  }, [open]);

  useEffect(() => {
    if (!rideId) return;

    let active = true;

    // 1. Carregar histórico inicial de mensagens
    const fetchMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('ride_messages')
          .select('*')
          .eq('ride_id', rideId)
          .order('created_at', { ascending: true });

        if (active && !error && data) {
          setMsgs(data as Msg[]);
        }
      } catch (err) {
        console.warn('[RideChat] Erro ao carregar mensagens:', err);
      }
    };

    void fetchMessages();

    // 2. Canal Realtime WebSocket para novas mensagens
    const channel = supabase
      .channel(`ride_chat_${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_messages',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const nextMsg = payload.new as Msg;
          if (!nextMsg || !nextMsg.id) return;

          setMsgs((prev) => {
            // Evita duplicados (caso tenha sido adicionada optimistically)
            if (prev.some((m) => m.id === nextMsg.id || (m.sender_id === nextMsg.sender_id && m.text === nextMsg.text && Math.abs(new Date(m.created_at).getTime() - new Date(nextMsg.created_at).getTime()) < 3000))) {
              return prev.map((m) => (m.text === nextMsg.text && m.sender_id === nextMsg.sender_id ? nextMsg : m));
            }
            return [...prev, nextMsg];
          });

          if (nextMsg.sender_id !== myId && !openRef.current) {
            setUnread((count) => count + 1);
          }
        },
      )
      .subscribe();

    // 3. Polling de contingência a cada 4s enquanto o chat estiver aberto ou activo
    const pollInterval = setInterval(() => {
      if (active) void fetchMessages();
    }, 4000);

    return () => {
      active = false;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [myId, rideId]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, open]);

  const send = async (msgToSend: string) => {
    const value = msgToSend.trim();
    if (!value || !rideId || !myId) return;

    // Mensagem optimista instantânea
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Msg = {
      id: tempId,
      sender_id: myId,
      text: value,
      created_at: new Date().toISOString(),
    };

    setMsgs((prev) => [...prev, optimisticMsg]);
    setText('');

    try {
      const { data, error } = await supabase.from('ride_messages').insert({
        ride_id: rideId,
        sender_id: myId,
        text: value,
      }).select().single();

      if (error) {
        console.error('[RideChat] Erro ao enviar mensagem na BD:', error);
      } else if (data) {
        setMsgs((prev) => prev.map((m) => (m.id === tempId ? (data as Msg) : m)));
      }
    } catch (e) {
      console.error('[RideChat] Excepção ao enviar:', e);
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
            const isMe = msg.sender_id === myId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    isMe
                      ? 'golden-gradient text-black font-semibold rounded-br-xs shadow-md'
                      : 'bg-white/10 text-white rounded-bl-xs border border-white/5'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[9px] text-white/40 mt-1 px-1 font-mono">
                  {new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                </span>
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
