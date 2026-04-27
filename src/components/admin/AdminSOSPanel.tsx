import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { PanicAlertRecord } from '../../types';

interface AdminSOSPanelProps {
  onActiveCountChange?: (count: number) => void;
}

interface AlertRow extends PanicAlertRecord {
  profiles?: { name: string | null; phone: string | null } | null;
  audioUrl?: string | null;
}

export default function AdminSOSPanel({ onActiveCountChange }: AdminSOSPanelProps) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const enrichAudioUrls = useCallback(async (rows: AlertRow[]) => {
    return Promise.all(rows.map(async (row) => {
      if (!row.audio_storage_path) {
        return { ...row, audioUrl: null };
      }

      const { data } = await supabase.storage
        .from('panic-audio')
        .createSignedUrl(row.audio_storage_path, 60 * 10);

      return {
        ...row,
        audioUrl: data?.signedUrl ?? null,
      };
    }));
  }, []);

  const loadAlerts = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('panic_alerts')
      .select(`
        *,
        profiles:user_id(name, phone)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[AdminSOSPanel]', error);
      setLoading(false);
      return;
    }

    const rows = await enrichAudioUrls((data ?? []) as AlertRow[]);
    setAlerts(rows);
    setLoading(false);
  }, [enrichAudioUrls]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-sos-panel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'panic_alerts' }, () => {
        void loadAlerts();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'panic_alerts' }, () => {
        void loadAlerts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAlerts]);

  const activeCount = useMemo(
    () => alerts.filter((alert) => alert.status === 'active').length,
    [alerts],
  );

  useEffect(() => {
    onActiveCountChange?.(activeCount);
  }, [activeCount, onActiveCountChange]);

  const handleStatusChange = async (alertId: string, status: 'resolved' | 'false_alarm') => {
    setUpdatingId(alertId);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('panic_alerts')
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id ?? null,
      })
      .eq('id', alertId);

    if (error) {
      console.error('[AdminSOSPanel.handleStatusChange]', error);
    }

    setUpdatingId(null);
    void loadAlerts();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-red-200/70">Safety shield</p>
            <h2 className="mt-2 text-lg font-black">Alertas SOS em tempo real</h2>
            <p className="mt-1 text-[11px] font-bold text-white/65">
              Monitorização activa da operação crítica, com resolução e evidência sonora.
            </p>
          </div>
          <div className="rounded-full border border-red-400/20 bg-red-500/15 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-100">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-400 align-middle animate-pulse" />
            {activeCount} activo{activeCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center text-sm font-bold text-white/60">
          A carregar alertas SOS...
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center text-sm font-bold text-white/60">
          Nenhum alerta de pânico registado.
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const createdAt = new Date(alert.created_at).toLocaleString('pt-AO');
            const severityTone = alert.severity === 'critical'
              ? 'bg-red-500/20 text-red-200'
              : alert.severity === 'high'
                ? 'bg-amber-500/20 text-amber-100'
                : 'bg-sky-500/20 text-sky-100';

            return (
              <div
                key={alert.id}
                className={`rounded-[2rem] border p-5 ${
                  alert.status === 'active'
                    ? 'border-red-500/25 bg-[#140608]'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-white">
                        {alert.profiles?.name ?? alert.driver_name ?? 'Utilizador Zenith'}
                      </span>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${severityTone}`}>
                        {alert.severity}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${
                          alert.status === 'active'
                            ? 'bg-red-500/20 text-red-100'
                            : alert.status === 'resolved'
                              ? 'bg-emerald-500/20 text-emerald-100'
                              : 'bg-amber-500/20 text-amber-100'
                        }`}
                      >
                        {alert.status === 'false_alarm' ? 'falso alarme' : alert.status}
                      </span>
                    </div>

                    <div className="grid gap-2 text-[11px] font-bold text-white/70">
                      <p>Hora: {createdAt}</p>
                      <p>
                        Localização:{' '}
                        {typeof alert.lat === 'number' && typeof alert.lng === 'number'
                          ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`
                          : 'Sem coordenadas exactas'}
                      </p>
                      {alert.profiles?.phone && (
                        <p>Contacto: {alert.profiles.phone}</p>
                      )}
                      {alert.driver_name && (
                        <p>Contraparte: {alert.driver_name}</p>
                      )}
                    </div>

                    {alert.audioUrl ? (
                      <audio controls preload="none" className="mt-2 w-full max-w-md">
                        <source src={alert.audioUrl} type="audio/webm" />
                      </audio>
                    ) : (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">
                        Sem áudio associado
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => void handleStatusChange(alert.id, 'resolved')}
                      disabled={updatingId === alert.id || alert.status !== 'active'}
                      className="rounded-full bg-emerald-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-100 disabled:opacity-40"
                    >
                      Resolver
                    </button>
                    <button
                      onClick={() => void handleStatusChange(alert.id, 'false_alarm')}
                      disabled={updatingId === alert.id || alert.status !== 'active'}
                      className="rounded-full bg-amber-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-100 disabled:opacity-40"
                    >
                      Falso alarme
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
