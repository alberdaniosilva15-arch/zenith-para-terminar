
import React, { useState, useMemo } from 'react';
import { UserRole, ChatMessage } from '../types';

const MOCK_MESSAGES: ChatMessage[] = [
  { id: '1', senderRole: UserRole.DRIVER, text: "Engarrafamento forte na descida da Estalagem. Evitem!", zone: "Viana", timestamp: Date.now(), type: 'traffic', confirmations: 12 },
  { id: '2', senderRole: UserRole.PASSENGER, text: "Bomba de combustível na Mutamba está com fila curta.", zone: "Maianga", timestamp: Date.now() - 600000, type: 'fuel', confirmations: 4 },
  { id: '3', senderRole: UserRole.DRIVER, text: "Operação Stop pesada no nó da Samba.", zone: "Geral", timestamp: Date.now() - 1200000, type: 'safety', confirmations: 28 },
];

const RideTalk: React.FC<{ zone: string, role: UserRole }> = ({ zone, role }) => {
  const [activeCat, setActiveCat] = useState<'all' | 'traffic' | 'safety' | 'fuel' | 'events'>('all');
  const [isRecording, setIsRecording] = useState(false);

  const filteredMessages = useMemo(() => {
    return MOCK_MESSAGES.filter(msg => {
        const zoneMatch = msg.zone === zone || zone === "Geral" || msg.zone === "Geral";
        const catMatch = activeCat === 'all' || msg.type === activeCat;
        return zoneMatch && catMatch;
    });
  }, [zone, activeCat]);

  const handleVoiceRecord = () => {
    setIsRecording(!isRecording);
    if (!isRecording) {
      // Iniciar captura do microfone
      navigator.mediaDevices.getUserMedia({ audio: true });
    }
  };

  return (
    <div className="mt-4 bg-surface-container-low border border-outline-variant/20 rounded-[2.5rem] overflow-hidden shadow-sm animate-in fade-in duration-700">
      <div className="bg-[#0A0A0A] px-6 py-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
            <span className="text-2xl">📻</span>
            <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">RideTalk Luanda: {zone}</h3>
        </div>
        <div className="flex items-center gap-2">
           <span className="w-1.5 h-1.5 rounded-full bg-error-container/200 animate-pulse"></span>
           <span className="text-[8px] text-white/40 font-black uppercase">LIVE</span>
        </div>
      </div>
      
      <div className="flex gap-2 p-4 bg-surface-container-lowest/50 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
          {(['all', 'traffic', 'safety', 'fuel', 'events'] as const).map(cat => (
              <button 
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`px-4 py-2 rounded-full text-[9px] font-black uppercase border transition-all shrink-0 ${activeCat === cat ? 'bg-surface-container-highest text-white border-outline-variant shadow-lg' : 'bg-surface-container-low text-on-surface-variant/70 border-outline-variant/20'}`}
              >
                  {cat === 'all' ? 'Tudo' : cat === 'traffic' ? 'Trânsito' : cat === 'safety' ? 'Segurança' : cat === 'fuel' ? 'Combustível' : 'Eventos'}
              </button>
          ))}
      </div>
      
      <div className="p-4 max-h-64 overflow-y-auto no-scrollbar space-y-4 bg-surface-container-low">
        {filteredMessages.map(msg => (
          <div key={msg.id} className="bg-surface-container-lowest p-5 rounded-[2rem] border border-outline-variant/20 relative transition-transform hover:scale-[1.01]">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg ${msg.senderRole === UserRole.DRIVER ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                      {msg.senderRole === UserRole.DRIVER ? 'Motorista Verificado' : 'Passageiro'}
                  </span>
              </div>
              <span className="text-[8px] text-on-surface-variant/70 font-bold uppercase">{Math.floor((Date.now() - msg.timestamp)/60000)}m atrás</span>
            </div>
            <p className="text-[11px] font-bold text-on-surface leading-relaxed">"{msg.text}"</p>
            <div className="mt-4 flex gap-2">
               <button className="flex-1 bg-surface-container-low border border-outline-variant/30 py-2 rounded-xl text-[9px] font-black uppercase text-on-surface-variant/70 hover:text-primary transition-colors">Confirmar ({msg.confirmations})</button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="p-5 border-t border-outline-variant/10 bg-surface-container-low">
        <div className="flex gap-3">
            <button 
              onClick={handleVoiceRecord}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all shadow-lg ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-surface-container-low text-outline'}`}
            >
               {isRecording ? '⏹️' : '🎙️'}
            </button>
            <input 
                type="text" 
                placeholder="Partilhe um alerta..." 
                className="flex-1 bg-surface-container-lowest border border-outline-variant/20 text-[10px] font-bold px-5 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-[#0A0A0A] text-white px-6 rounded-2xl text-xs font-black shadow-xl">ENVIAR</button>
        </div>
      </div>
    </div>
  );
};

export default RideTalk;
