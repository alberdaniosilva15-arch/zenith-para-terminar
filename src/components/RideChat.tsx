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
        className="zr-button"
        style={{ position: 'relative' }}
      >
        <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>chat</span>
        Chat com {peerName}
        {unread > 0 && (
          <span style={{ position: 'absolute', top: '-4px', right: '-4px', backgroundColor: 'var(--danger)', color: '#fff', fontSize: '10px', fontWeight: 'bold', width: '20px', height: '20px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="zr-modal is-open zr-chat" style={{ zIndex: 50, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)' }}>
      <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-inline zr-inline--between">
          <div>
            <h3 className="zr-section-title" style={{ fontSize: '16px', margin: 0 }}>{peerName}</h3>
            {phonePrivacyMode && (
              <span className="zr-meta" style={{ color: 'var(--gold)', fontSize: '10px' }}>Número protegido - usa o chat</span>
            )}
            <div style={{ marginTop: '4px' }}>
              <KazeCreditsBadge userId={myId} rideId={rideId} />
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="zr-icon-button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="zr-chat" style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {msgs.length === 0 && (
          <div className="zr-empty" style={{ margin: 'auto' }}>
            <p className="zr-meta">Nenhuma mensagem ainda. Diz olá!</p>
          </div>
        )}
        {msgs.map((msg) => (
          <div key={msg.id} className={`zr-bubble ${msg.sender_id === myId ? 'zr-bubble--self' : 'zr-bubble--other'}`}>
            {msg.text}
            <span className="zr-meta" style={{ display: 'block', textAlign: 'right', fontSize: '9px', marginTop: '4px', opacity: 0.7 }}>
              {new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '8px 16px', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-scroll-x">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => void send(reply)}
              className="zr-chip"
              style={{ fontSize: '10px' }}
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-inline" style={{ gap: '8px' }}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void send(text); }}
            placeholder="Escreve uma mensagem..."
            maxLength={500}
            className="zr-input"
            style={{ flex: 1 }}
          />
          <button
            onClick={() => void send(text)}
            disabled={!text.trim()}
            className="zr-icon-button"
            style={{ backgroundColor: 'var(--gold)', color: '#000', width: '48px', height: '48px', borderRadius: '12px' }}
          >
            <span className="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
