import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface AdminLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children, activeTab, onTabChange }) => {
  const { signOut } = useAuth();

  const tabs = [
    { id: 'kaze', label: 'Kaze Core', icon: 'psychology' },
    { id: 'map', label: 'Mapa em Tempo Real', icon: 'map' },
    { id: 'market', label: 'Mercado e Financas', icon: 'payments' },
    { id: 'pricing', label: 'Precos por Zona', icon: 'local_atm' },
    { id: 'security', label: 'SOS e Seguranca', icon: 'emergency' },
    { id: 'users', label: 'Utilizadores', icon: 'group' },
    { id: 'drivers', label: 'Frota de Motoristas', icon: 'local_taxi' },
    { id: 'settings', label: 'Definicoes', icon: 'settings' },
  ];

  return (
    <div className="bg-[#000000] text-on-surface font-body-md antialiased selection:bg-primary selection:text-[#000000] h-screen flex flex-col overflow-hidden">
      <nav className="hidden md:flex justify-between items-center h-14 w-full pl-72 pr-6 bg-[#000000]/90 backdrop-blur-xl border-b border-outline-variant/15 z-50 flex-shrink-0">
        <div className="flex items-center gap-xl">
          <span className="text-headline-lg font-headline-xl font-bold text-primary uppercase tracking-tight">ZENITH RIDE COMMAND</span>
          <div className="flex gap-lg ml-8">
            <span className="text-on-surface-variant font-medium hover:text-primary transition-colors duration-150 cursor-pointer active:scale-95 font-label-md uppercase tracking-widest">Operacoes Globais</span>
            <span className="text-primary font-bold border-b-2 border-primary pb-1 cursor-pointer active:scale-95 transition-transform font-label-md uppercase tracking-widest">Cluster de Luanda</span>
          </div>
        </div>
        <div className="flex items-center gap-lg">
          <span className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors duration-150 cursor-pointer active:scale-95 text-2xl">account_circle</span>
          <div className="relative">
            <span className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors duration-150 cursor-pointer active:scale-95 text-2xl">notifications</span>
            <span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full animate-pulse"></span>
          </div>
          <span onClick={signOut} title="Terminar Sessao" className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors duration-150 cursor-pointer active:scale-95 text-2xl">logout</span>
        </div>
      </nav>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-72 flex-shrink-0 flex-col border-r border-outline-variant/15 bg-[#050505]/95 backdrop-blur-xl shadow-[10px_0_30px_rgba(0,0,0,0.8)]">
          <div className="px-4 py-4 border-b border-outline-variant/15 mb-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center border border-primary/30 flex-shrink-0">
                <span className="material-symbols-outlined text-primary text-xl">admin_panel_settings</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-headline-lg text-primary text-sm font-bold tracking-tight truncate">Centro de Comando</h2>
                <p className="font-label-sm text-on-surface-variant uppercase tracking-widest mt-0.5 text-[10px]">Cluster de Luanda</p>
              </div>
            </div>
            <button className="w-full bg-primary text-[#000000] font-label-md uppercase tracking-widest py-2.5 rounded-md font-bold hover:bg-primary-fixed transition-colors text-xs">
              MOBILIZAR RECURSOS
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto flex flex-col gap-1 px-2 pb-4">

            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <div
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-md transition-all duration-150 ${
                    isActive
                      ? 'text-primary bg-primary/10 border-r-2 border-primary shadow-[0_0_15px_rgba(233,195,73,0.3)] rounded-r-none'
                      : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-variant/20 hover:text-primary'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-xl flex-shrink-0"
                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                  >
                    {tab.icon}
                  </span>
                  <span className="font-label-md uppercase tracking-widest text-xs">{tab.label}</span>
                </div>
              );
            })}
          </nav>
        </aside>

        <main className={`flex-1 min-w-0 flex flex-col relative bg-[#000000] ${activeTab === 'map' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
          {children}
        </main>
      </div>

      <footer className="hidden md:flex h-8 justify-between items-center pl-72 pr-6 border-t border-outline-variant/15 bg-[#000000]/95 backdrop-blur-md flex-shrink-0">
        <span className="font-label-sm text-on-surface-variant uppercase text-[10px]">ESTADO DO SISTEMA: OPERACIONAL • CLUSTER LUANDA ACTIVO</span>
        <div className="flex items-center gap-4">
          <span className="font-label-sm text-on-surface-variant hover:text-primary transition-colors cursor-pointer text-[10px]">Registo de Eventos</span>
          <span className="font-label-sm text-on-surface-variant hover:text-primary transition-colors cursor-pointer text-[10px]">Estado da Rede</span>
          <span className="font-label-sm text-on-surface-variant hover:text-primary transition-colors cursor-pointer text-[10px]">Protocolo de Seguranca</span>
        </div>
      </footer>
    </div>
  );
};
