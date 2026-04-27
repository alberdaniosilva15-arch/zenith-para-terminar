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
    'Ja cheguei',
    'Aguarda 2 min',
    'Ok, perfeito!',
    'Onde estas exactamente?',
  ];

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!rideId) {
      return;
    }

    let active = true;

    supabase
      .from('ride_messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at')
      .then(({ data }) => {
        if (active && data) {
          setMsgs(data as Msg[]);
        }
      });

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
          setMsgs((prev) => [...prev, nextMsg]);
          if (nextMsg.sender_id !== myId && !openRef.current) {
            setUnread((value) => value + 1);
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [myId, rideId]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, open]);

  const send = async (msg: string) => {
    const value = msg.trim();
    if (!value) {
      return;
    }

    setText('');
    await supabase.from('ride_messages').insert({
      ride_id: rideId,
      sender_id: myId,
      text: value,
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        className="relative flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg"
      >
        Chat com {peerName}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black">
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
      <div className="flex items-start justify-between border-b border-white/10 bg-[#111] px-4 py-3">
        <div className="space-y-2">
          <p className="text-sm font-bold text-white">{peerName}</p>
          {phonePrivacyMode && (
            <p className="text-[10px] text-yellow-400">Numero protegido - usa o chat</p>
          )}
          <KazeCreditsBadge userId={myId} rideId={rideId} />
        </div>
        <button onClick={() => setOpen(false)} className="text-2xl leading-none text-white/60">
          &times;
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <p className="mt-8 text-center text-xs text-white/30">Nenhuma mensagem ainda. Diz ola!</p>
        )}
        {msgs.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender_id === myId ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.sender_id === myId ? 'bg-primary text-white' : 'bg-white/10 text-white'
              }`}
            >
              {msg.text}
              <span className="mt-0.5 block text-right text-[9px] opacity-50">
                {new Date(msg.created_at).toLocaleTimeString('pt-PT', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {quickReplies.map((reply) => (
          <button
            key={reply}
            onClick={() => void send(reply)}
            className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] text-white"
          >
            {reply}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-[#111] px-3 pb-4 pt-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void send(text);
            }
          }}
          placeholder="Escreve uma mensagem..."
          maxLength={500}
          className="flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white outline-none"
        />
        <button
          onClick={() => void send(text)}
          disabled={!text.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary disabled:opacity-40"
        >
          <span className="text-lg">&gt;</span>
        </button>
      </div>
    </div>
  );
}
