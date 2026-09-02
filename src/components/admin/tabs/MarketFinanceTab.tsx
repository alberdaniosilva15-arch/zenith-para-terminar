import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

interface FinanceRideRow {
  id: string;
  price_kz: number | null;
  status: string | null;
  created_at: string;
  origin_address: string | null;
  dest_address: string | null;
}

type FinancePeriod = '24h' | '7d' | '30d';

const PERIOD_OPTIONS: Array<{ id: FinancePeriod; label: string; hours: number }> = [
  { id: '24h', label: '24H', hours: 24 },
  { id: '7d', label: '7D', hours: 24 * 7 },
  { id: '30d', label: '30D', hours: 24 * 30 },
];

function getPeriodStart(period: FinancePeriod) {
  const option = PERIOD_OPTIONS.find((item) => item.id === period) || PERIOD_OPTIONS[0] || { hours: 24 };
  return new Date(Date.now() - option.hours * 60 * 60 * 1000).toISOString();
}

function escapeCsv(value: string | number | null | undefined) {
  const normalized = String(value ?? '');
  return `"${normalized.replace(/"/g, '""')}"`;
}

export const MarketFinanceTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FinanceRideRow[]>([]);
  const [period, setPeriod] = useState<FinancePeriod>('7d');
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [completedRides, setCompletedRides] = useState(0);

  const fetchFinances = async (activePeriod = period) => {
    setLoading(true);
    setError(null);

    try {
      const sinceIso = getPeriodStart(activePeriod);
      const [metricsRes, rowsRes] = await Promise.all([
        supabase
          .from('rides')
          .select('price_kz', { count: 'exact' })
          .eq('status', 'completed')
          .gte('created_at', sinceIso),
        supabase
          .from('rides')
          .select('id, price_kz, status, created_at, origin_address, dest_address')
          .eq('status', 'completed')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (metricsRes.error) throw metricsRes.error;
      if (rowsRes.error) throw rowsRes.error;

      const revenueRows = metricsRes.data ?? [];
      setTotalRevenue(revenueRows.reduce((sum, ride) => sum + Number(ride.price_kz ?? 0), 0));
      setCompletedRides(metricsRes.count ?? 0);
      setData((rowsRes.data ?? []) as FinanceRideRow[]);
    } catch (e: any) {
      console.error('[MarketFinanceTab.fetchFinances]', e);
      setError(e.message || 'Falha de rede. Verifica a ligacao ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFinances(period);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const averageTicket = completedRides > 0 ? Math.round(totalRevenue / completedRides) : 0;
  const platformFee = Math.round(totalRevenue * 0.15);
  const driverPayout = Math.round(totalRevenue * 0.85);
  const activePeriodLabel = PERIOD_OPTIONS.find((item) => item.id === period)?.label ?? '7D';

  const exportRows = () => {
    if (!data.length) return;

    const csv = [
      ['origem', 'destino', 'valor_bruto_kz', 'comissao_zenith_15', 'repasse_motorista_85', 'data'],
      ...data.map((ride) => [
        ride.origin_address || 'Origem indisponivel',
        ride.dest_address || 'Destino indisponivel',
        Math.round(Number(ride.price_kz ?? 0)),
        Math.round(Number(ride.price_kz ?? 0) * 0.15),
        Math.round(Number(ride.price_kz ?? 0) * 0.85),
        new Date(ride.created_at).toISOString(),
      ]),
    ]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `zenith_financas_${period}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const cyclePeriod = () => {
    setPeriod((current) => {
      if (current === '24h') return '7d';
      if (current === '7d') return '30d';
      return '24h';
    });
  };

  return (
    <div className="w-full h-full overflow-y-auto px-margin-desktop py-lg max-w-[1600px] mx-auto space-y-8 pb-24 bg-[#000000]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-outline-variant/30 pb-4 gap-4">
        <div>
          <h2 className="font-headline-xl text-on-surface tracking-tight">Mercado e Financas</h2>
          <p className="font-body-md text-on-surface-variant mt-2">Volume Transacionado & Divisão de Receitas \ Cluster Luanda</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={exportRows}
            disabled={loading || data.length === 0}
            className="px-4 py-2 bg-transparent border border-primary/50 text-primary font-label-md uppercase tracking-widest rounded hover:bg-primary/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold"
          >
            <span className="material-symbols-outlined text-sm">download</span> Exportar CSV
          </button>
          <button
            onClick={cyclePeriod}
            className="px-4 py-2 bg-primary text-[#000000] font-label-md uppercase tracking-widest rounded font-bold hover:bg-primary-fixed transition-colors flex items-center gap-2 text-xs"
            title="Alternar periodo entre 24H, 7D e 30D"
          >
            <span className="material-symbols-outlined text-sm">filter_alt</span> {activePeriodLabel}
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setPeriod(option.id)}
            className={`px-3 py-1.5 rounded border text-xs font-bold tracking-widest uppercase transition-colors ${
              period === option.id
                ? 'bg-primary text-[#000000] border-primary'
                : 'border-primary/20 text-on-surface-variant hover:border-primary/50 hover:text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="material-symbols-outlined text-5xl text-red-400">cloud_off</span>
          <p className="text-sm text-red-400 max-w-sm">{error}</p>
          <button
            onClick={() => void fetchFinances()}
            className="mt-2 px-5 py-2 text-sm rounded border border-white/20 text-white/70 hover:bg-white/10 transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={`Volume Bruto (${activePeriodLabel})`} value={`${Math.round(totalRevenue).toLocaleString('pt-AO')} Kz`} />
            <MetricCard label={`Comissão Zenith (15%)`} value={`${platformFee.toLocaleString('pt-AO')} Kz`} highlight />
            <MetricCard label={`Repasse Motoristas (85%)`} value={`${driverPayout.toLocaleString('pt-AO')} Kz`} />
            <MetricCard label="Ticket Médio / Corridas" value={`${averageTicket.toLocaleString('pt-AO')} Kz (${completedRides})`} />
          </div>

          {data.length === 0 ? (
            <div className="flex flex-col gap-6 items-center justify-center py-20 text-center opacity-70">
              <span className="material-symbols-outlined text-6xl text-on-surface-variant">monitoring</span>
              <p className="font-body-lg text-on-surface-variant">Sem corridas concluidas para agregar neste periodo.</p>
              <p className="font-body-sm text-on-surface-variant">Assim que houver viagens com status `completed`, a receita aparece aqui.</p>
            </div>
          ) : (
            <div className="bg-[#050505]/90 border border-primary/15 rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 md:grid-cols-[1.2fr_1.2fr_0.7fr_0.8fr] gap-3 border-b border-primary/10 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                <span>Origem</span>
                <span>Destino</span>
                <span>Valor</span>
                <span>Data</span>
              </div>
              <div className="divide-y divide-primary/5">
                {data.map((ride) => (
                  <div key={ride.id} className="grid grid-cols-2 md:grid-cols-[1.2fr_1.2fr_0.7fr_0.8fr] gap-3 px-6 py-4 text-sm text-on-surface">
                    <span>{ride.origin_address || 'Origem indisponivel'}</span>
                    <span>{ride.dest_address || 'Destino indisponivel'}</span>
                    <span className="font-bold text-primary">{Math.round(Number(ride.price_kz ?? 0)).toLocaleString('pt-AO')} Kz</span>
                    <span className="text-on-surface-variant">{new Date(ride.created_at).toLocaleDateString('pt-AO')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${
      highlight ? 'border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(233,195,73,0.15)]' : 'border-primary/15 bg-[#050505]/80'
    }`}>
      <div className="font-label-sm uppercase tracking-widest text-on-surface-variant text-[11px]">{label}</div>
      <div className="mt-3 text-2xl font-black text-primary">{value}</div>
    </div>
  );
}
