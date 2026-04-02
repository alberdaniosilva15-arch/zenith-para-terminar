
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AutonomousCommand } from '../types';
import { geminiService } from '../services/geminiService';

const MOCK_ZONES = [
  { name: 'Viana', demand: 92, risk: 5 },
  { name: 'Cazenga', demand: 75, risk: 22 },
  { name: 'Talatona', demand: 98, risk: 3 },
  { name: 'Maianga', demand: 82, risk: 8 },
  { name: 'Zango', demand: 88, risk: 12 },
];

interface AdminDashboardProps {
  lastCommand?: AutonomousCommand | null;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ lastCommand }) => {
  const [activeTab, setActiveTab] = useState<'security' | 'market' | 'kaze'>('security');
  const [commands, setCommands] = useState<AutonomousCommand[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchDecisions = async () => {
      setLoading(true);
      try {
        const data = await geminiService.getAutonomousDecisions({
          system_load: 0.85,
          luanda_time: new Date().toLocaleTimeString(),
          hot_zones: MOCK_ZONES.filter(z => z.demand > 80).map(z => z.name)
        });
        setCommands(data);
      } catch (e) {
        console.error("Erro ao carregar dados administrativos");
      } finally {
        setLoading(false);
      }
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-surface-container-lowest flex flex-col">
      <div className="bg-[#0A0A0A] p-10 space-y-4 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-primary rounded-full blur-[100px] opacity-20 animate-pulse"></div>
        <div className="flex justify-between items-start relative z-10">
          <div>
            <span className="bg-surface-container-low/10 border border-white/20 px-3 py-1 rounded-lg font-black text-[9px] uppercase tracking-widest mb-4 inline-block">MotoGo AI Core v4.5</span>
            <h1 className="text-3xl font-black tracking-tighter italic">PAINEL DE <span className="text-primary">CONTROLO</span></h1>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-primary/60 uppercase tracking-widest">Vigilante Central</p>
            <p className="text-xs font-black text-primary flex items-center justify-end gap-2 mt-1">
               <span className="w-2 h-2 rounded-full bg-primary/100 animate-pulse"></span> ONLINE
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-8 relative z-20">
        <div className="bg-surface-container-low p-2 rounded-[2.5rem] shadow-2xl flex gap-1 border border-outline-variant/20">
           {(['security', 'market', 'kaze'] as const).map(tab => (
             <button 
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`flex-1 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'golden-gradient text-on-primary shadow-xl' : 'text-on-surface-variant/70 hover:bg-surface-container-lowest'}`}
             >
               {tab === 'security' ? '🛡️ Segurança' : tab === 'market' ? '📈 Mercado' : '🤖 IA Core'}
             </button>
           ))}
        </div>
      </div>

      <div className="p-6 space-y-6 flex-1 overflow-y-auto no-scrollbar">
        {activeTab === 'security' && (
          <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center px-2">
               <h2 className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">Monitorização de Anomalias Luanda</h2>
               {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>}
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {commands.map(cmd => (
                <div key={cmd.id} className="bg-surface-container-low p-6 rounded-[2.5rem] border-l-4 border-primary shadow-sm flex justify-between items-center">
                  <div className="space-y-1">
                     <p className="text-[8px] font-black uppercase text-primary tracking-widest">{cmd.type}</p>
                     <h4 className="font-black text-on-surface text-sm tracking-tight">{cmd.reason}</h4>
                     <p className="text-[9px] font-bold text-on-surface-variant/70 uppercase">{cmd.target}</p>
                  </div>
                  <div className="text-right">
                     <p className="text-[8px] font-black text-on-surface-variant/50 uppercase mb-1">Impacto</p>
                     <span className="bg-surface-container-highest text-white text-[9px] px-3 py-1 rounded-full font-black">{cmd.intensity}x</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-red-950 text-white p-8 rounded-[3rem] shadow-2xl border border-white/5 space-y-6">
               <h3 className="text-[10px] font-black uppercase tracking-widest text-red-500">Vigilante IA: Alertas Críticos</h3>
               <div className="space-y-4">
                  <div className="flex gap-4 items-center bg-primary/5 p-4 rounded-2xl">
                     <span className="text-2xl">🚨</span>
                     <div>
                        <p className="text-xs font-black">Cazenga - Desvio Suspeito</p>
                        <p className="text-[9px] opacity-50 uppercase font-bold">Motorista ID #402 sob vigilância ativa</p>
                     </div>
                  </div>
               </div>
            </div>
          </div>
        )}

        {activeTab === 'market' && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                   <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">Ganhos Globais 24h</p>
                   <p className="text-3xl font-black text-primary italic tracking-tighter">850k <span className="text-xs font-normal">Kz</span></p>
                </div>
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                   <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">Motoristas Ativos</p>
                   <p className="text-3xl font-black text-on-surface italic tracking-tighter">1.4k</p>
                </div>
             </div>

             <div className="bg-surface-container-low p-8 rounded-[3rem] shadow-sm border border-outline-variant/20 h-80">
                <h3 className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-8">Heatmap de Demanda Luanda</h3>
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={MOCK_ZONES}>
                      <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} tick={{fontWeight: '900', fill: '#94a3b8'}} />
                      <Tooltip contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', fontWeight: 'black', fontSize: '10px'}} />
                      <Bar dataKey="demand" radius={[12, 12, 12, 12]} barSize={28}>
                        {MOCK_ZONES.map((entry, index) => (
                           <Cell key={`cell-${index}`} fill={entry.risk > 15 ? '#ef4444' : '#4f46e5'} />
                        ))}
                      </Bar>
                   </BarChart>
                </ResponsiveContainer>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
