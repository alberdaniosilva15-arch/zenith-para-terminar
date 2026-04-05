// =============================================================================
// ZENITH RIDE v3.0 — Toast.tsx
// Componente de notificações de sistema (erros, sucesso, info)
// =============================================================================

import React from 'react';
import { useToastStore } from '../store/useAppStore';

const ICONS = { success: '✅', error: '❌', info: 'ℹ️' };
const COLORS = {
  success: 'border-green-500/40 bg-green-950/80',
  error:   'border-red-500/40 bg-red-950/80',
  info:    'border-primary/40 bg-surface-container/80',
};

const Toast: React.FC = () => {
  const { toast, clearToast } = useToastStore();
  if (!toast) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-4 rounded-2xl border backdrop-blur-xl shadow-2xl text-white max-w-[90vw] animate-in slide-in-from-top-4 duration-300 ${COLORS[toast.type]}`}
      onClick={clearToast}
    >
      <span className="text-xl shrink-0">{ICONS[toast.type]}</span>
      <p className="font-black text-xs leading-tight">{toast.message}</p>
    </div>
  );
};

export default Toast;
