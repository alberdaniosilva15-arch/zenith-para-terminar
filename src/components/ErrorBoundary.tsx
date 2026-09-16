// =============================================================================
// ZENITH RIDE v3.3 — ErrorBoundary.tsx
//
// Captura erros de renderização antes de crashar toda a app.
//
// v3.3 — Isolamento granular de falhas:
//   • `name`           — identifica o subsistema na consola/logger (ex: "AgoraCall")
//   • `compact`        — fallback minimalista inline em vez de ecrã completo
//   • `fallback`       — ReactNode estático de substituição
//   • `fallbackRender` — render prop com (error, reset) para recuperação fina
//   • `reset()`        — recupera sem recarregar a página (volta a montar os filhos)
//
// Prioridade de renderização em caso de erro:
//   fallbackRender  >  fallback  >  compact  >  ecrã completo (legado)
//
// Retrocompatibilidade: `<ErrorBoundary>{children}</ErrorBoundary>` continua a
// comportar-se exactamente como antes.
// =============================================================================

import React from 'react';
import { logError } from '../lib/logger';

interface Props {
  children: React.ReactNode;
  /** Identificador do subsistema isolado — aparece no log e no fallback compacto. */
  name?: string;
  /** Fallback inline e discreto, para erros de periféricos/rede num cartão. */
  compact?: boolean;
  /** Nó estático de substituição quando ocorre um erro. */
  fallback?: React.ReactNode;
  /** Render prop com acesso ao erro e à função de reset. */
  fallbackRender?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Muda a cada reset() para forçar a remontagem dos filhos. */
  resetKey: number;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const scope = this.props.name ? `ErrorBoundary:${this.props.name}` : 'ErrorBoundary';
    console.error(`[${scope}] Erro capturado:`, error, info.componentStack);
    logError(scope, error, {
      componentStack: info.componentStack,
      boundary: this.props.name ?? null,
    });
  }

  /** Recupera do erro sem recarregar a página inteira. */
  reset = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  render() {
    const { children, name, compact, fallback, fallbackRender } = this.props;

    if (!this.state.hasError) {
      return <React.Fragment key={this.state.resetKey}>{children}</React.Fragment>;
    }

    const error = this.state.error ?? new Error('Erro desconhecido');

    if (fallbackRender) {
      return <>{fallbackRender(error, this.reset)}</>;
    }

    if (fallback !== undefined) {
      // `fallback={null}` é intencional: o subsistema desaparece silenciosamente.
      return <>{fallback}</>;
    }

    if (compact) {
      return (
        <div
          role="alert"
          data-boundary={name ?? 'anonymous'}
          className="w-full rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-left"
        >
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[20px] text-amber-300/90 mt-0.5">
              warning
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-200/90">
                Módulo indisponível{name ? ` · ${name}` : ''}
              </p>
              <p className="text-[11px] text-white/60 font-medium mt-1 leading-snug">
                Este componente falhou, mas o resto do ecrã continua a funcionar normalmente.
              </p>
              <p className="text-[10px] text-white/30 mt-1 break-words">{error.message}</p>
              <button
                type="button"
                onClick={this.reset}
                className="mt-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-[10px] font-black uppercase tracking-widest text-white/85"
              >
                Tentar de novo
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center gap-6 p-8 text-center">
        <span className="material-symbols-outlined text-6xl">warning</span>
        <div>
          <p className="text-white font-black text-lg uppercase tracking-widest mb-2">Algo correu mal</p>
          <p className="text-white/50 text-sm font-bold mb-1">{error.message}</p>
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
}

export default ErrorBoundary;
