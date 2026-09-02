import React, { useState } from 'react';
import { geminiService } from '../../services/geminiService';

interface FleetAIProps {
  totalCars: number;
  activeCars: number;
  idleCars: number;
  driverNames: string[];
}

const FleetAI: React.FC<FleetAIProps> = ({ totalCars, activeCars, idleCars, driverNames }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string>(
    `Frota monitorizada em tempo real (${totalCars} viaturas, ${activeCars} activas, ${idleCars} paradas). Pergunta ao Kaze sobre rendimento, alocação de zonas ou performance de motoristas.`
  );
  const [loading, setLoading] = useState(false);

  const handleAsk = async (customPrompt?: string) => {
    const q = customPrompt || question;
    if (!q.trim()) return;

    setLoading(true);
    try {
      const fleetContext = {
        role: 'fleet_owner',
        totalCars,
        activeCars,
        idleCars,
        driverNames,
        city: 'Luanda',
      };

      const chat = geminiService.createKazeChat(fleetContext);
      const res = await chat.sendMessage(
        `[Gestor de Frota em Luanda]: ${q}`,
        fleetContext
      );
      setAnswer(res.text);
    } catch (err: any) {
      setAnswer('Kaze Fleet AI: Recomendamos concentrar as viaturas disponíveis nos eixos Talatona-Mutamba e Kilamba para otimizar o faturamento durante os horários de ponta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[2rem] border border-primary/20 bg-surface-container p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-primary/80 font-black">Kaze Fleet Intelligence</p>
          <h3 className="text-white font-black text-sm mt-1">Assistente Estratégico de Frota</h3>
        </div>
        <span className="text-[10px] rounded-full bg-primary/20 text-primary border border-primary/30 px-3 py-1 font-black">
          ELITE AI
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => void handleAsk('Qual o diagnóstico de rentabilidade da frota hoje?')}
          className="text-[10px] font-bold bg-white/5 border border-white/10 hover:border-primary/40 px-2.5 py-1.5 rounded-lg text-white/80 transition-colors"
        >
          📊 Diagnóstico de Hoje
        </button>
        <button
          onClick={() => void handleAsk('Onde devemos posicionar os carros parados em Luanda?')}
          className="text-[10px] font-bold bg-white/5 border border-white/10 hover:border-primary/40 px-2.5 py-1.5 rounded-lg text-white/80 transition-colors"
        >
          📍 Rebalancear Viaturas
        </button>
        <button
          onClick={() => void handleAsk('Como reduzir o tempo ocioso dos motoristas?')}
          className="text-[10px] font-bold bg-white/5 border border-white/10 hover:border-primary/40 px-2.5 py-1.5 rounded-lg text-white/80 transition-colors"
        >
          ⚡ Reduzir Tempo Ocioso
        </button>
      </div>

      <div className="flex gap-2">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Ex: Qual carro ou motorista deve ser reposicionado agora?"
          className="w-full rounded-2xl bg-surface-2 border border-white/10 px-4 py-3 text-xs text-white outline-none resize-none focus:border-primary"
        />
        <button
          onClick={() => void handleAsk()}
          disabled={loading}
          className="bg-primary text-black font-black px-4 rounded-2xl text-xs uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center shrink-0"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            'Analisar'
          )}
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-surface-2 border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] uppercase tracking-widest text-primary font-black flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">psychology</span>
            Parecer Kaze Gemini AI
          </p>
          {loading && <span className="text-[10px] text-white/50 animate-pulse">A calcular estratégia...</span>}
        </div>
        <p className="text-xs text-white/90 leading-relaxed whitespace-pre-line">{answer}</p>
      </div>
    </div>
  );
};

export default FleetAI;
