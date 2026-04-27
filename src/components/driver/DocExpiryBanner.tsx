import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface DocExpiryBannerProps {
  driverId: string;
  onOpenDocuments: () => void;
}

interface DriverDocumentsState {
  status: 'approved' | 'pending' | 'rejected';
  expires_at: string | null;
}

export default function DocExpiryBanner({ driverId, onOpenDocuments }: DocExpiryBannerProps) {
  const [documentState, setDocumentState] = useState<DriverDocumentsState | null>(null);

  useEffect(() => {
    if (!driverId) return;

    let active = true;

    const loadState = async () => {
      const { data, error } = await supabase
        .from('driver_documents')
        .select('status, expires_at')
        .eq('driver_id', driverId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.warn('[DocExpiryBanner]', error.message);
        return;
      }

      setDocumentState((data ?? null) as DriverDocumentsState | null);
    };

    void loadState();
    return () => {
      active = false;
    };
  }, [driverId]);

  const banner = useMemo(() => {
    if (!documentState) return null;

    if (documentState.status === 'rejected') {
      return {
        tone: 'danger',
        title: 'Documentos rejeitados',
        body: 'Corrige os dados do teu carro e BI para voltares a operar sem bloqueios.',
      };
    }

    if (documentState.status === 'pending') {
      return {
        tone: 'warning',
        title: 'Documentos em análise',
        body: 'A equipa Zenith ainda está a validar o teu pacote. Actualiza se houver algo desactualizado.',
      };
    }

    if (!documentState.expires_at) {
      return null;
    }

    const expiresAt = new Date(documentState.expires_at);
    const today = new Date();
    const diffDays = Math.ceil((expiresAt.getTime() - today.getTime()) / 86_400_000);

    if (diffDays > 30) {
      return null;
    }

    if (diffDays <= 0) {
      return {
        tone: 'danger',
        title: 'Documentos expirados',
        body: 'Os teus documentos já passaram da validade. Actualiza agora para evitares interrupções.',
      };
    }

    return {
      tone: diffDays <= 7 ? 'danger' : 'warning',
      title: 'Documentos a expirar',
      body: `Faltam ${diffDays} dia${diffDays === 1 ? '' : 's'} para a validade terminar. Atualiza antes de ficares offline.`,
    };
  }, [documentState]);

  if (!banner) return null;

  const toneClasses = banner.tone === 'danger'
    ? 'border-red-500/25 bg-red-500/12 text-red-100'
    : 'border-amber-400/25 bg-amber-400/12 text-amber-100';

  return (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${toneClasses}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em]">
            {banner.tone === 'danger' ? 'Alerta documental' : 'Validade documental'}
          </p>
          <h3 className="mt-2 text-sm font-black">{banner.title}</h3>
          <p className="mt-1 text-[11px] font-bold text-white/75">{banner.body}</p>
        </div>
        <button
          onClick={onOpenDocuments}
          className="rounded-full bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-white/15"
        >
          Atualizar documentos
        </button>
      </div>
    </div>
  );
}
