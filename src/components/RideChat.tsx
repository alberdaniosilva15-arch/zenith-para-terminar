import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Msg { id: string; sender_id: string; text: string; created_at: string; }

interface RideChatProps {
  rideId: string;
  myId: string;
  peerName: string;
  /** Se true, o botão de ligar o número real fica oculto */
  phonePrivacyMode?: boolean;
}

export default function RideChat({ rideId, myId, peerName, phonePrivacyMode = false }: RideChatProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mensagens pré-definidas rápidas (evita digitar no trânsito)
  const quickReplies = ['Estou a caminho', 'Já cheguei', 'Aguarda 2 min', 'Ok, perfeito!', 'Onde estás exactamente?'];

  useEffect(() => {
    if (!rideId) return;
    // Carregar mensagens existentes
    supabase
      .from('ride_messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at')
      .then(({ data }) => { if (data) setMsgs(data); });

    // Subscrever a novas mensagens em tempo real
    const ch = supabase
      .channel(`ride_chat_${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ride_messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        setMsgs(prev => [...prev, payload.new as Msg]);
        if (!open) setUnread(u => u + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [rideId, open]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, open]);

  const send = async (msg: string) => {
    const t = msg.trim();
    if (!t) return;
    setText('');
    await supabase.from('ride_messages').insert({ ride_id: rideId, sender_id: myId, text: t });
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setUnread(0); }}
        className="relative flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-full text-sm font-bold shadow-lg"
      >
        💬 Chat com {peerName}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-black">
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-white/10">
        <div>
          <p className="font-bold text-white text-sm">{peerName}</p>
          {phonePrivacyMode && (
            <p className="text-[10px] text-yellow-400">🔒 Número protegido — usa o chat</p>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="text-white/60 text-2xl leading-none">&times;</button>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {msgs.length === 0 && (
          <p className="text-center text-white/30 text-xs mt-8">Nenhuma mensagem ainda. Diz olá!</p>
        )}
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.sender_id === myId ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
              m.sender_id === myId ? 'bg-primary text-white' : 'bg-white/10 text-white'
            }`}>
              {m.text}
              <span className="block text-[9px] opacity-50 mt-0.5 text-right">
                {new Date(m.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Respostas rápidas */}
      <div className="px-3 py-2 flex gap-2 overflow-x-auto">
        {quickReplies.map(q => (
          <button key={q} onClick={() => send(q)}
            className="shrink-0 px-3 py-1.5 bg-white/10 text-white text-[11px] rounded-full border border-white/20">
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 pb-4 pt-2 bg-[#111]">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send(text)}
          placeholder="Escreve uma mensagem..."
          maxLength={500}
          className="flex-1 bg-white/10 text-white rounded-full px-4 py-2.5 text-sm outline-none border border-white/10"
        />
        <button onClick={() => send(text)} disabled={!text.trim()}
          className="w-10 h-10 bg-primary rounded-full flex items-center justify-center disabled:opacity-40">
          <span className="text-lg">➤</span>
        </button>
      </div>
    </div>
  );
}
