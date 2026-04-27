import React, { useMemo, useState } from 'react';

interface FleetAIProps {
  totalCars: number;
  activeCars: number;
  idleCars: number;
  driverNames: string[];
}

const FleetAI: React.FC<FleetAIProps> = ({ totalCars, activeCars, idleCars, driverNames }) => {
  const [question, setQuestion] = useState('');

  const proactiveTip = useMemo(() => {
    if (idleCars >= 2) {
      return 'Tens varios carros parados. Vale activar uma redistribuicao para zonas de maior procura antes do pico da tarde.';
    }
    if (activeCars === 0 && totalCars > 0) {
      return 'Nenhuma viatura esta activa agora. Vale contactar os motoristas em espera e rever a janela de blackout.';
    }
    return 'A frota esta equilibrada. Aproveita para rever motoristas com baixa actividade e ajustar as zonas de entrada.';
  }, [activeCars, idleCars, totalCars]);

  const answer = useMemo(() => {
    if (!question.trim()) {
      return proactiveTip;
    }

    const normalized = question.toLowerCase();
    if (normalized.includes('preju') || normalized.includes('pior')) {
      return idleCars > 0
        ? `O maior risco agora esta nas viaturas paradas. Prioriza primeiro os carros sem actividade recente e fala com ${driverNames[0] ?? 'o motorista com menor rotação'}.`
        : 'Nao vejo carros claramente deficitarios agora, mas compensa vigiar quem passa muito tempo online sem corridas concluídas.';
    }
    if (normalized.includes('zona')) {
      return 'Hoje compensa concentrar a frota em zonas com mais procura pendular e manter uma reserva perto de Talatona e Ingombota.';
    }
    if (normalized.includes('trocar') || normalized.includes('motorista')) {
      return driverNames.length > 0
        ? `Antes de trocar motoristas, compara tempo ocioso, taxa de cancelamento e adesao aos acordos. Comeca por rever ${driverNames[0]}.`
        : 'Ainda preciso de motoristas associados para sugerir trocas com contexto.';
    }
    return proactiveTip;
  }, [driverNames, idleCars, proactiveTip, question]);

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-primary/70 font-black">Fleet AI</p>
          <h3 className="text-white font-black text-sm mt-1">Kaze para gestao da frota</h3>
        </div>
        <span className="text-[10px] rounded-full bg-primary/10 text-primary px-3 py-1 font-black">ELITE</span>
      </div>

      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        rows={3}
        placeholder="Qual carro esta a render menos hoje?"
        className="w-full rounded-2xl bg-black/20 border border-white/10 px-4 py-3 text-sm text-white outline-none resize-none"
      />

      <div className="mt-4 rounded-2xl bg-black/20 border border-white/10 p-4">
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-black mb-2">Resposta</p>
        <p className="text-sm text-white/80 leading-relaxed">{answer}</p>
      </div>
    </div>
  );
};

export default FleetAI;
