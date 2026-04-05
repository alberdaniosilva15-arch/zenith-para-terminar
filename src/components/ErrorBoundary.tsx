// =============================================================================
// ZENITH RIDE v3.0 — ErrorBoundary.tsx
// Captura erros de renderização antes de crashar toda a app
// =============================================================================

import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Erro capturado:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="text-6xl">⚠️</div>
          <div>
            <p className="text-white font-black text-lg uppercase tracking-widest mb-2">Algo correu mal</p>
            <p className="text-white/50 text-sm font-bold mb-1">
              {this.state.error?.message ?? 'Erro desconhecido'}
            </p>
            <p className="text-white/30 text-xs">Recarrega a página para continuar.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-4 bg-primary text-white font-black text-sm uppercase rounded-2xl shadow-xl hover:bg-primary/90 active:scale-95 transition-all"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
