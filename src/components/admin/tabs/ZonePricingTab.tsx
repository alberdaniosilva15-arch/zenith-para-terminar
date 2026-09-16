import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Ligação ao motor de preço
//
// Estas são as colunas REAIS de `public.pricing_config`. A tab deixou de ser um
// simulador: lê e escreve a linha activa — a mesma que a função
// `calculate_fare_engine_pro` consulta para cobrar. O app, o bot do WhatsApp e
// o Kaze apanham a alteração no pedido seguinte, sem deploy.
//
// Regra: uma chave por coluna. Não inventar nomes nem duplicar a fórmula aqui.
// ─────────────────────────────────────────────────────────────────────────────
const COLUNAS_PRECO = [
  'base_fare_kz', 'rate_per_km_kz', 'rate_per_min_kz',
  'surge_alpha', 'surge_max', 'traffic_threshold',
  'fee_night_kz', 'fee_airport_kz', 'fee_traffic_kz', 'fee_cancel_kz',
  'platform_commission',
  'wl_talatona', 'wl_miramar', 'wl_alvalade', 'wl_patriota', 'wl_viana', 'wl_cacuaco',
  'wl_default', 'wl_standard', 'wl_premium', 'wl_eco',
  'u_standard', 'u_vip', 'u_problematic', 'u_new',
] as const;

type ColunaPreco = (typeof COLUNAS_PRECO)[number];
type Precos = Record<ColunaPreco, number>;

// Iguais aos DEFAULT da tabela — valem só até a linha real chegar.
const PRECOS_PADRAO: Precos = {
  base_fare_kz: 300, rate_per_km_kz: 182, rate_per_min_kz: 15,
  surge_alpha: 0.5, surge_max: 2.5, traffic_threshold: 1.3,
  fee_night_kz: 200, fee_airport_kz: 500, fee_traffic_kz: 150, fee_cancel_kz: 300,
  platform_commission: 0.15,
  wl_talatona: 1.4, wl_miramar: 1.2, wl_alvalade: 1.2, wl_patriota: 1.4,
  wl_viana: 0.9, wl_cacuaco: 0.9, wl_default: 1.0, wl_standard: 1.0,
  wl_premium: 1.8, wl_eco: 0.8,
  u_standard: 1.0, u_vip: 0.85, u_problematic: 1.3, u_new: 1.0,
};

type EstadoDb = 'a-carregar' | 'pronto' | 'a-guardar' | 'guardado' | 'erro';

interface OptsSlider {
  min: number;
  max: number;
  step: number;
  escala?: number;   // multiplica o valor da BD para dar a posição do slider
  exibir?: number;   // multiplica a posição para dar o número mostrado
  dec?: number;
  sufixo: string;
}

const formatarData = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-AO', { dateStyle: 'short', timeStyle: 'short' });
};

// Linha de `zone_prices` + o preço que o motor calcularia para a mesma viagem
// (vem da função `zone_price_suggestions`).
interface LinhaZona {
  id: string;
  origin_zone: string;
  dest_zone: string;
  price_kz: number;
  distance_km: number | null;
  active: boolean;
  formula_price_kz: number | null;
  zone_multiplier: number | null;
  badges: string[] | null;
}

type CamposZona = Partial<Pick<LinhaZona, 'price_kz' | 'distance_km' | 'active'>>;

// Quanto é que a tarifa fixa está acima (ou abaixo) do preço da fórmula.
const desvioPct = (fixo: number, formula: number | null): number | null =>
  formula && formula > 0 ? Math.round(((fixo - formula) / formula) * 100) : null;

export const ZonePricingTab: React.FC = () => {
  const [activeTab, setActiveTab] = useState('calc');
  const [mode, setMode] = useState<'basic' | 'zenith' | 'hybrid'>('basic');

  // Configuração real de preços — uma chave por coluna de `pricing_config`.
  const [precos, setPrecos] = useState<Precos>(PRECOS_PADRAO);
  const [idConfig, setIdConfig] = useState<string | null>(null);
  const [estadoDb, setEstadoDb] = useState<EstadoDb>('a-carregar');
  const [msgDb, setMsgDb] = useState('');
  const [guardadoEm, setGuardadoEm] = useState<string | null>(null);
  const [porGuardar, setPorGuardar] = useState(false);

  const aplicarLinha = (linha: Record<string, unknown>) => {
    const lido: Precos = { ...PRECOS_PADRAO };
    for (const c of COLUNAS_PRECO) {
      const v = linha[c];
      if (v !== null && v !== undefined) lido[c] = Number(v);
    }
    setIdConfig(String(linha.id));
    setPrecos(lido);
    setGuardadoEm((linha.updated_at as string | undefined) ?? null);
    setEstadoDb('pronto');
    setPorGuardar(false);
  };

  // `pricing_config` tem leitura pública ("pricing: leitura publica"), por isso
  // a leitura funciona sempre. A escrita é que passa pela política
  // "pricing: admin write", que exige users.role = 'admin'.
  const lerDoBanco = async () => {
    const { data, error } = await supabase
      .from('pricing_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      setEstadoDb('erro');
      setMsgDb(error.message);
      return;
    }
    if (!data) {
      setEstadoDb('erro');
      setMsgDb('Não há nenhuma linha activa em pricing_config.');
      return;
    }
    aplicarLinha(data as Record<string, unknown>);
  };

  useEffect(() => {
    void lerDoBanco();
    // Só na montagem: `lerDoBanco` é recriada a cada render mas só toca em
    // setState e nas constantes do módulo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alterar = (coluna: ColunaPreco, valor: number) => {
    setPrecos((prev) => ({ ...prev, [coluna]: valor }));
    setPorGuardar(true);
    if (estadoDb === 'guardado') setEstadoDb('pronto');
  };

  const guardarPrecos = async () => {
    if (!idConfig) {
      setEstadoDb('erro');
      setMsgDb('Ainda não carreguei a configuração. Usa "Recarregar" e tenta de novo.');
      return;
    }
    setEstadoDb('a-guardar');
    setMsgDb('');

    // `pricing_config` não tem trigger de `updated_at`, por isso escrevemo-lo.
    const patch: Record<string, number | string> = {
      updated_at: new Date().toISOString(),
    };
    for (const c of COLUNAS_PRECO) patch[c] = precos[c];

    const { data, error } = await supabase
      .from('pricing_config')
      .update(patch)
      .eq('id', idConfig)
      .select('id, updated_at')
      .maybeSingle();

    if (error) {
      setEstadoDb('erro');
      setMsgDb(error.message);
      return;
    }

    // Armadilha: quando o RLS bloqueia, o PostgREST responde 200 sem erro e com
    // zero linhas. Sem isto o painel dizia "Guardado" sem ter gravado nada.
    if (!data) {
      setEstadoDb('erro');
      setMsgDb(
        'A base de dados não gravou nada. O mais provável é a tua conta não ter ' +
          'role = admin — a política RLS "pricing: admin write" exige isso.',
      );
      return;
    }

    setGuardadoEm(
      (data as { updated_at?: string } | null)?.updated_at ?? new Date().toISOString(),
    );
    setEstadoDb('guardado');
    setPorGuardar(false);
  };

  const recarregar = async () => {
    setEstadoDb('a-carregar');
    setMsgDb('');
    await lerDoBanco();
  };

  const textoEstado =
    estadoDb === 'a-carregar'
      ? 'A ler pricing_config…'
      : estadoDb === 'a-guardar'
        ? 'A gravar…'
        : estadoDb === 'guardado'
          ? `Guardado${guardadoEm ? ' · ' + formatarData(guardadoEm) : ''}`
          : estadoDb === 'erro'
            ? 'Sem ligação ao motor de preço'
            : `Ligado ao motor de preço${guardadoEm ? ' · última alteração ' + formatarData(guardadoEm) : ''}${
                porGuardar ? ' · alterações por guardar' : ''
              }`;

  // Linha de slider ligada a uma coluna real. É uma FUNÇÃO (não um componente)
  // para o React não desmontar o <input> a cada render — isso cortava o arrasto.
  const linhaSlider = (label: string, coluna: ColunaPreco, o: OptsSlider) => {
    const escala = o.escala ?? 1;
    const exibir = o.exibir ?? 1;
    const dec = o.dec ?? 0;
    // Arredondar a posição: em JS `0.15 * 100` dá 15.000000000000002, e não
    // queremos mandar lixo para o `value` do <input>.
    const posicao = Math.round(precos[coluna] * escala * 1000) / 1000;
    return (
      <div className="ze-sl-row" key={coluna}>
        <span className="ze-sl-label">{label}</span>
        <input
          type="range"
          min={o.min}
          max={o.max}
          step={o.step}
          value={posicao}
          onChange={(e) => alterar(coluna, (+e.target.value) / escala)}
        />
        <span className="ze-sl-val">
          {(posicao * exibir).toFixed(dec)} {o.sufixo}
        </span>
      </div>
    );
  };

  // ── Zonas fixas (zone_prices) ──────────────────────────────────────────────
  // Estas tarifas têm PRIORIDADE sobre o motor: se existir um par de zonas, é
  // este preço que o passageiro paga. Por isso o painel mostra ao lado o preço
  // que o motor calcularia para a mesma viagem — para se ver se ainda faz sentido.
  const [linhas, setLinhas] = useState<LinhaZona[]>([]);
  const [estadoZonas, setEstadoZonas] = useState<EstadoDb>('a-carregar');
  const [msgZonas, setMsgZonas] = useState('');
  const [alteradas, setAlteradas] = useState<Record<string, CamposZona>>({});

  const lerZonas = async () => {
    const { data, error } = await supabase.rpc('zone_price_suggestions');
    if (error) {
      setEstadoZonas('erro');
      setMsgZonas(error.message);
      return;
    }
    setLinhas((data ?? []) as LinhaZona[]);
    setAlteradas({});
    setEstadoZonas('pronto');
  };

  useEffect(() => {
    void lerZonas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editarZona = (id: string, campo: keyof CamposZona, valor: number | boolean) => {
    setAlteradas((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
    setEstadoZonas('pronto');
  };

  const precoDe = (l: LinhaZona) => Number(alteradas[l.id]?.price_kz ?? l.price_kz);
  const distDe = (l: LinhaZona) => Number(alteradas[l.id]?.distance_km ?? l.distance_km ?? 0);
  const activaDe = (l: LinhaZona) => Boolean(alteradas[l.id]?.active ?? l.active);

  const usarFormula = (l: LinhaZona) => {
    if (l.formula_price_kz == null) return;
    editarZona(l.id, 'price_kz', Number(l.formula_price_kz));
  };

  const usarFormulaEmTodas = () => {
    const novas: Record<string, CamposZona> = {};
    for (const l of linhas) {
      if (l.formula_price_kz == null) continue;
      novas[l.id] = { price_kz: Number(l.formula_price_kz) };
    }
    setAlteradas((prev) => ({ ...prev, ...novas }));
    setEstadoZonas('pronto');
  };

  const guardarZonas = async () => {
    const ids = Object.keys(alteradas);
    if (ids.length === 0) {
      setMsgZonas('Não há alterações para gravar.');
      return;
    }
    setEstadoZonas('a-guardar');
    setMsgZonas('');

    const falhas: string[] = [];
    for (const id of ids) {
      const l = linhas.find((x) => x.id === id);
      if (!l) continue;
      const rotulo = `${l.origin_zone} → ${l.dest_zone}`;

      const { data, error } = await supabase
        .from('zone_prices')
        .update({
          price_kz: precoDe(l),
          distance_km: distDe(l),
          active: activaDe(l),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        falhas.push(`${rotulo}: ${error.message}`);
      } else if (!data) {
        // Mesma armadilha do pricing_config: o RLS bloqueia com 200 e zero linhas.
        falhas.push(`${rotulo}: a base de dados não gravou (sem permissão de admin?)`);
      }
    }

    await lerZonas();
    if (falhas.length > 0) {
      setEstadoZonas('erro');
      setMsgZonas(falhas.join(' · '));
    } else {
      setEstadoZonas('guardado');
      setMsgZonas(`${ids.length} tarifa(s) gravada(s).`);
    }
  };

  const textoZonas =
    estadoZonas === 'a-carregar'
      ? 'A ler zone_prices…'
      : estadoZonas === 'a-guardar'
        ? 'A gravar…'
        : estadoZonas === 'guardado'
          ? 'Guardado'
          : estadoZonas === 'erro'
            ? 'Erro ao gravar'
            : `${linhas.length} tarifas${Object.keys(alteradas).length > 0 ? ` · ${Object.keys(alteradas).length} por guardar` : ''}`;

  const abaixoDaFormula = linhas.filter((l) => {
    const d = desvioPct(precoDe(l), l.formula_price_kz);
    return d != null && d < -5;
  }).length;

  // Features
  const [features, setFeatures] = useState({
    explain: true,
    lock: true,
    rec: true,
    cap: true,
    user: false,
    psych: false,
    tiers: false
  });

  // Params
  const [pBase, setPBase] = useState(300);
  const [pDist, setPDist] = useState(8);
  const [pTime, setPTime] = useState(20);
  const [pRd, setPRd] = useState(182);
  const [pRt, setPRt] = useState(15);
  const [pFees, setPFees] = useState(0);
  const [pComm, setPComm] = useState(12);

  const [pDemand, setPDemand] = useState(30);
  const [pSupply, setPSupply] = useState(20);
  const [pAlpha, setPAlpha] = useState(5);

  const [pWl, setPWl] = useState(10);
  const [pWt, setPWt] = useState(10);
  const [pC, setPC] = useState(10);
  const [pU, setPU] = useState(10);

  const [negoMin, setNegoMin] = useState(15);
  const [negoMax, setNegoMax] = useState(10);

  // Revenue
  const [rRides, setRRides] = useState(200);
  const [rFare, setRFare] = useState(2000);
  const [rComm, setRComm] = useState(12);
  const [rOpex, setROpex] = useState(30);
  const [rSurgePct, setRSurgePct] = useState(25);
  const [rSurgeMult, setRSurgeMult] = useState(15);

  // Computed Values - Calc
  const alphaVal = pAlpha / 10;
  const rawS = 1 + alphaVal * (pDemand / Math.max(pSupply, 1));
  const S = Math.min(rawS, precos.surge_max);

  let fare = 0;
  let formulaText = '';
  
  if (mode === 'basic') {
    fare = pBase + (pDist * pRd) + (pTime * pRt) * S + pFees;
    formulaText = `Fare = ${pBase} + (${pDist} × ${pRd}) + (${pTime} × ${pRt}) × ${S.toFixed(2)} + ${pFees}`;
  } else {
    const wl = pWl / 10;
    const wt = pWt / 10;
    const c = pC / 10;
    const u = pU / 10;
    fare = pBase + (pDist * pRd * wl) + (pTime * pRt * wt) * S * c * u + pFees;
    formulaText = `Fare = ${pBase} + (${pDist}×${pRd}×${wl.toFixed(1)}) + (${pTime}×${pRt}×${wt.toFixed(1)}) × ${S.toFixed(2)}×${c.toFixed(1)}×${u.toFixed(1)} + ${pFees}`;
  }

  if (features.psych) {
    fare = Math.round(fare / 10) * 10 - 1;
    if (fare < 0) fare = 0;
  } else {
    fare = Math.round(fare);
  }

  const yourCut = Math.round(fare * (pComm / 100));
  const driverCut = fare - yourCut;

  // Computed Values - Nego
  const totalNego = negoMin + negoMax;
  const rW = Math.round((negoMin / totalNego) * 100);
  const aW = Math.round((negoMax / totalNego) * 100);
  const gW = 100 - rW - aW;

  // Computed Values - Revenue
  const gmvDay = Math.round(rRides * rFare);
  const surgeBonus = Math.round(rRides * (rSurgePct / 100) * rFare * ((rSurgeMult / 10) - 1) * (rComm / 100));
  const grossDay = Math.round(gmvDay * (rComm / 100)) + surgeBonus;
  const netDay = Math.round(grossDay * (1 - rOpex / 100));
  const margin = gmvDay > 0 ? Math.round((netDay / gmvDay) * 100) : 0;

  const maxNet = Math.round(2500 * rFare * (rComm / 100) * (1 - rOpex / 100) * 30);
  const phases = [
    { label: 'Mês 1–2 · 50 corridas/dia', r: 50, color: '#0a3d1e' },
    { label: 'Mês 3–4 · 200 corridas/dia', r: 200, color: '#00b85a' },
    { label: 'Mês 5–6 · 800 corridas/dia', r: 800, color: '#00e676' },
    { label: 'Ano 1 · 2 500 corridas/dia', r: 2500, color: '#80ffc0' }
  ];

  const fmt = (n: number) => Math.round(n).toLocaleString('pt-AO');

  const setPreset = (p: string) => {
    const ps: Record<string, any> = {
      rain: { wl: 12, wt: 18, c: 14, u: 10 },
      event: { wl: 15, wt: 13, c: 18, u: 10 },
      night: { wl: 13, wt: 10, c: 13, u: 10 },
      premium: { wl: 18, wt: 10, c: 10, u: 10 },
      vip: { wl: 10, wt: 10, c: 10, u: 7 },
      bad: { wl: 10, wt: 10, c: 10, u: 14 },
      reset: { wl: 10, wt: 10, c: 10, u: 10 }
    };
    if (ps[p]) {
      setPWl(ps[p].wl);
      setPWt(ps[p].wt);
      setPC(ps[p].c);
      setPU(ps[p].u);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#0d0d0d] text-[#f0ede8] font-sans">
      <style>{`
        .ze-root { --bg:#0d0d0d; --bg2:#141414; --bg3:#1c1c1c; --bg4:#242424; --text:#f0ede8; --text2:#888880; --text3:#555550; --border:rgba(255,255,255,0.07); --border2:rgba(255,255,255,0.12); --green:#00e676; --green-dim:#0a3d1e; --green-mid:#00b85a; --red:#ff4444; --red-dim:#3d0a0a; --amber:#ffaa00; --amber-dim:#3d2800; --blue:#4488ff; --blue-dim:#0a1f3d; --accent:#00e676; }
        .ze-header { padding:2rem 2rem 0; display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
        .ze-logo { font-family:'Syne',sans-serif; font-size:28px; font-weight:700; letter-spacing:-0.03em; }
        .ze-logo span { color:var(--accent); }
        .ze-logo-sub { font-size:11px; font-family:'DM Mono',monospace; color:var(--text3); letter-spacing:.1em; text-transform:uppercase; margin-top:2px; }
        .ze-header-tag { font-family:'DM Mono',monospace; font-size:10px; color:var(--text3); border:0.5px solid var(--border2); border-radius:4px; padding:3px 8px; letter-spacing:.06em; }
        
        .ze-tabs-wrap { padding:1.5rem 2rem 0; display:flex; gap:4px; border-bottom:0.5px solid var(--border); overflow-x:auto; scrollbar-width:none; }
        .ze-tabs-wrap::-webkit-scrollbar { display:none; }
        .ze-tab { font-family:'DM Mono',monospace; font-size:11px; letter-spacing:.05em; padding:8px 18px; border:none; background:transparent; color:var(--text3); cursor:pointer; white-space:nowrap; border-bottom:2px solid transparent; margin-bottom:-0.5px; transition:all .2s; text-transform:uppercase; }
        .ze-tab:hover { color:var(--text2); }
        .ze-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
        
        .ze-main { padding:1.5rem 2rem 4rem; }
        .ze-card { background:var(--bg2); border:0.5px solid var(--border); border-radius:12px; padding:1.25rem; margin-bottom:12px; }
        .ze-card.accent-border { border-color:rgba(0,230,118,.2); }
        .ze-section-title { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--text3); margin-bottom:14px; }
        
        .ze-sl-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
        .ze-sl-row:last-child { margin-bottom:0; }
        .ze-sl-label { font-size:12px; color:var(--text2); min-width:120px; flex-shrink:0; }
        .ze-sl-val { font-family:'DM Mono',monospace; font-size:12px; font-weight:500; min-width:70px; text-align:right; color:var(--text); }
        .ze-sl-row input[type=range] { flex:1; min-width:0; -webkit-appearance:none; appearance:none; height:3px; background:var(--bg4); border-radius:2px; outline:none; cursor:pointer; }
        .ze-sl-row input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:var(--accent); cursor:pointer; transition:transform .15s; }
        .ze-sl-row input[type=range]:hover::-webkit-slider-thumb { transform:scale(1.2); }
        
        .ze-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
        .ze-grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:12px; }
        .ze-grid4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:8px; margin-bottom:12px; }
        @media(max-width:600px){ .ze-grid3,.ze-grid4,.ze-grid2{grid-template-columns:1fr 1fr;} .ze-sl-label{min-width:90px;font-size:11px;} }
        
        .ze-metric { background:var(--bg3); border-radius:8px; padding:12px 14px; }
        .ze-metric-label { font-size:11px; color:var(--text3); margin-bottom:4px; font-family:'DM Mono',monospace; letter-spacing:.04em; }
        .ze-metric-val { font-family:'Syne',sans-serif; font-size:22px; font-weight:600; color:var(--text); }
        .ze-metric-val.green { color:var(--green); }
        .ze-metric-val.red { color:var(--red); }
        .ze-metric-val.amber { color:var(--amber); }
        .ze-metric-val.blue { color:var(--blue); }
        .ze-metric-sub { font-size:10px; color:var(--text3); margin-top:2px; font-family:'DM Mono',monospace; }
        
        .ze-formula-box { font-family:'DM Mono',monospace; font-size:13px; background:var(--bg3); border:0.5px solid var(--border2); border-radius:8px; padding:14px 16px; margin-bottom:14px; line-height:2; word-break:break-all; }
        .ze-formula-box .hi { color:var(--accent); font-weight:500; }
        
        .ze-btn-group { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
        .ze-btn { font-family:'DM Mono',monospace; font-size:11px; letter-spacing:.04em; padding:6px 14px; border:0.5px solid var(--border2); border-radius:6px; background:transparent; color:var(--text2); cursor:pointer; transition:all .15s; text-transform:uppercase; }
        .ze-btn:hover { background:var(--bg3); color:var(--text); border-color:var(--border2); }
        .ze-btn.active { background:var(--green-dim); color:var(--green); border-color:rgba(0,230,118,.3); }
        
        .ze-btn-preset { font-size:11px; padding:5px 10px; border:0.5px solid var(--border); border-radius:6px; background:var(--bg3); color:var(--text2); cursor:pointer; font-family:'DM Mono',monospace; transition:all .15s; }
        .ze-btn-preset:hover { border-color:var(--accent); color:var(--accent); }
        
        .ze-badge { display:inline-flex; align-items:center; font-size:10px; padding:2px 8px; border-radius:20px; font-weight:500; font-family:'DM Mono',monospace; letter-spacing:.04em; gap:4px; }
        .ze-badge-green { background:var(--green-dim); color:var(--green); }
        .ze-badge-red { background:var(--red-dim); color:var(--red); }
        .ze-badge-amber { background:var(--amber-dim); color:var(--amber); }
        .ze-badge-blue { background:var(--blue-dim); color:var(--blue); }
        .ze-badge::before { content:''; width:5px; height:5px; border-radius:50%; background:currentColor; flex-shrink:0; }
        
        .ze-divider { border:none; border-top:0.5px solid var(--border); margin:14px 0; }
        .ze-db-linha { display:flex; align-items:center; gap:8px; }
        .ze-db-ponto { width:8px; height:8px; border-radius:50%; background:var(--text3); flex-shrink:0; }
        .ze-db-ponto--pronto, .ze-db-ponto--guardado { background:var(--green); }
        .ze-db-ponto--a-carregar, .ze-db-ponto--a-guardar { background:var(--amber); }
        .ze-db-ponto--erro { background:var(--red); }
        .ze-db-texto { font-size:12px; color:var(--text2); }
        .ze-db-erro { margin-top:10px; font-size:12px; color:var(--red); line-height:1.6; word-break:break-word; }
        .ze-db-ok { margin-top:10px; font-size:12px; color:var(--green); line-height:1.6; }
        .ze-tbl-wrap { overflow-x:auto; }
        .ze-tbl { width:100%; border-collapse:collapse; font-size:12px; }
        .ze-tbl th { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--text3); text-align:left; padding:6px 8px; border-bottom:0.5px solid var(--border2); white-space:nowrap; }
        .ze-tbl td { padding:5px 8px; border-bottom:0.5px solid var(--border); color:var(--text2); white-space:nowrap; }
        .ze-tbl tr.dirty td { background:rgba(255,170,0,.07); }
        .ze-tbl tr.off td { opacity:.45; }
        .ze-num { width:88px; background:var(--bg3); border:0.5px solid var(--border2); border-radius:5px; color:var(--text); font-family:'DM Mono',monospace; font-size:12px; padding:4px 6px; }
        .ze-num:focus { outline:none; border-color:var(--accent); }
        .ze-formula { font-family:'DM Mono',monospace; color:var(--text); }
        .ze-delta-baixo { color:var(--red); }
        .ze-delta-cima { color:var(--amber); }
        .ze-delta-ok { color:var(--green); }
        .ze-mini { font-family:'DM Mono',monospace; font-size:10px; padding:3px 8px; border:0.5px solid var(--border2); border-radius:5px; background:transparent; color:var(--text2); cursor:pointer; }
        .ze-mini:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
        .ze-mini:disabled { opacity:.4; cursor:default; }
        
        .ze-nego-bar { position:relative; height:28px; background:var(--bg4); border-radius:6px; margin:8px 0; overflow:hidden; display:flex; }
        .ze-nego-zone { display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:500; font-family:'DM Mono',monospace; transition:width .3s; }
        
        .ze-rec-box { background:var(--bg3); border-radius:8px; padding:12px 14px; margin-top:10px; border:0.5px solid var(--border); }
        .ze-rec-title { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.08em; color:var(--text3); text-transform:uppercase; margin-bottom:6px; }
        .ze-rec-body { font-size:13px; color:var(--text); line-height:1.6; }
        .ze-rec-body span { color:var(--accent); font-weight:500; }
        
        .ze-insight { background:var(--green-dim); border:0.5px solid rgba(0,230,118,.15); border-radius:8px; padding:12px 14px; margin-bottom:10px; }
        .ze-insight-title { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--green); margin-bottom:6px; }
        .ze-insight-body { font-size:12px; color:rgba(240,237,232,.7); line-height:1.7; }
        .ze-warn { background:var(--amber-dim); border:0.5px solid rgba(255,170,0,.15); }
        .ze-warn .ze-insight-title { color:var(--amber); }
        .ze-danger { background:var(--red-dim); border:0.5px solid rgba(255,68,68,.15); }
        .ze-danger .ze-insight-title { color:var(--red); }
        
        .ze-cmp-row { display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:0.5px solid var(--border); font-size:13px; }
        .ze-cmp-row:last-child { border-bottom:none; }
        .ze-cmp-label { color:var(--text2); }
        .ze-cmp-val { font-family:'DM Mono',monospace; font-size:12px; color:var(--text); }
        
        .ze-bar-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; font-size:12px; }
        .ze-bar-bg { flex:1; height:6px; background:var(--bg4); border-radius:3px; overflow:hidden; min-width:0; }
        .ze-bar-fill { height:100%; border-radius:3px; transition:width .4s; }
        .ze-bar-label { color:var(--text2); min-width:140px; flex-shrink:0; }
        .ze-bar-val { font-family:'DM Mono',monospace; min-width:50px; text-align:right; color:var(--text3); }
        
        .ze-phase-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
        @media(max-width:600px){ .ze-phase-grid{grid-template-columns:1fr;} }
        .ze-phase-card { background:var(--bg3); border-radius:8px; padding:12px 14px; border:0.5px solid var(--border); }
        .ze-phase-num { font-family:'Syne',sans-serif; font-size:32px; font-weight:700; color:var(--accent); line-height:1; margin-bottom:4px; }
        .ze-phase-name { font-size:11px; color:var(--text2); margin-bottom:8px; font-family:'DM Mono',monospace; letter-spacing:.04em; text-transform:uppercase; }
        .ze-phase-kpi { font-size:11px; color:var(--text3); line-height:1.8; }
        
        .ze-explainer-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
        @media(max-width:600px){ .ze-explainer-grid{grid-template-columns:1fr;} }
        .ze-exp-item { background:var(--bg3); border-radius:6px; padding:10px 12px; border-left:2px solid var(--accent); }
        .ze-exp-var { font-family:'DM Mono',monospace; font-size:12px; color:var(--accent); margin-bottom:3px; }
        .ze-exp-desc { font-size:11px; color:var(--text2); }
        
        .ze-toggle-wrap { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:0.5px solid var(--border); }
        .ze-toggle-wrap:last-child { border-bottom:none; }
        .ze-toggle-label { font-size:12px; color:var(--text2); }
        .ze-toggle { position:relative; width:36px; height:20px; cursor:pointer; flex-shrink:0; }
        .ze-toggle input { opacity:0; width:0; height:0; position:absolute; }
        .ze-toggle-track { position:absolute; inset:0; background:var(--bg4); border-radius:10px; transition:.2s; border:0.5px solid var(--border2); }
        .ze-toggle-thumb { position:absolute; width:14px; height:14px; top:2px; left:2px; background:var(--text3); border-radius:50%; transition:.2s; }
        .ze-toggle input:checked ~ .ze-toggle-track { background:var(--green-dim); border-color:rgba(0,230,118,.3); }
        .ze-toggle input:checked ~ .ze-toggle-thumb { left:20px; background:var(--green); }
        
        .ze-score-wrap { display:flex; align-items:center; gap:20px; margin-bottom:14px; }
        .ze-score-ring { position:relative; width:80px; height:80px; flex-shrink:0; }
        .ze-score-ring svg { transform:rotate(-90deg); }
        .ze-score-ring .ze-score-num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-size:22px; font-weight:700; color:var(--accent); }
        .ze-score-desc { font-size:13px; color:var(--text2); line-height:1.6; }
        .ze-score-desc strong { color:var(--text); font-weight:500; }
        
        .ze-risk-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:0.5px solid var(--border); font-size:13px; }
        .ze-risk-row:last-child { border-bottom:none; }
        .ze-risk-name { color:var(--text2); flex:1; padding-right:12px; }
        
        .ze-seg-item { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:0.5px solid var(--border); font-size:13px; }
        .ze-seg-item:last-child { border-bottom:none; }
        .ze-seg-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .ze-seg-name { color:var(--text2); flex:1; }
        .ze-seg-val { font-family:'DM Mono',monospace; color:var(--text); font-size:12px; }
      `}</style>

      <div className="ze-root">
        <div className="ze-header">
          <div>
            <div className="ze-logo">ZENITH<span>.</span>ENGINE</div>
            <div className="ze-logo-sub">Sistema de Pricing Profissional — Angola</div>
          </div>
          <div className="ze-header-tag">v2.0 PRO</div>
        </div>

        <div className="ze-tabs-wrap">
          {[
            { id: 'calc', label: 'Calculadora' },
            { id: 'formula', label: 'Fórmulas' },
            { id: 'zonas', label: 'Zonas fixas' },
            { id: 'revenue', label: 'Receita & Lucro' },
            { id: 'risk', label: 'Riscos' },
            { id: 'audience', label: 'Audiência' },
            { id: 'settings', label: 'Configurar' }
          ].map(t => (
            <button
              key={t.id}
              className={`ze-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ze-main">
          {activeTab === 'calc' && (
            <div>
              <div className="ze-card">
                <div className="ze-section-title">modo de cálculo</div>
                <div className="ze-btn-group">
                  <button className={`ze-btn ${mode === 'basic' ? 'active' : ''}`} onClick={() => setMode('basic')}>Base (Uber/Bolt)</button>
                  <button className={`ze-btn ${mode === 'zenith' ? 'active' : ''}`} onClick={() => setMode('zenith')}>Zenith Avançado</button>
                  <button className={`ze-btn ${mode === 'hybrid' ? 'active' : ''}`} onClick={() => setMode('hybrid')}>Híbrido + Negociação</button>
                </div>
                <div className="ze-formula-box">{formulaText}</div>
                <div className="ze-grid3">
                  <div className="ze-metric">
                    <div className="ze-metric-label">Tarifa Final</div>
                    <div className="ze-metric-val">{fmt(fare)} Kz</div>
                    <div className="ze-metric-sub">{mode === 'basic' ? 'Modelo base' : 'Zenith ' + (mode === 'hybrid' ? 'híbrido' : 'avançado')}</div>
                  </div>
                  <div className="ze-metric">
                    <div className="ze-metric-label">Surge Activo</div>
                    <div className="ze-metric-val amber">{S.toFixed(2)}×</div>
                    <div className="ze-metric-sub">{S < 1.3 ? 'Mercado estável' : S < 1.8 ? 'Demanda elevada' : 'Alta procura!'}</div>
                  </div>
                  <div className="ze-metric">
                    <div className="ze-metric-label">Tua Receita</div>
                    <div className="ze-metric-val green">{fmt(yourCut)} Kz</div>
                    <div className="ze-metric-sub">{pComm}% desta corrida</div>
                  </div>
                </div>
                
                {features.rec && (
                  <div className="ze-rec-box">
                    <div className="ze-rec-title">recomendação ao utilizador</div>
                    <div className="ze-rec-body">
                      {S > 1.8 ? 
                        <><span style={{color: 'var(--accent)', fontWeight: 500}}>Alta demanda</span> — diz ao utilizador: "Espere 3-5 minutos para pagar menos." Isso reduz abandono e cria confiança.</>
                      : S > 1.3 ?
                        <><span style={{color: 'var(--accent)', fontWeight: 500}}>Procura moderada</span> — corrida disponível ao preço actual. Preço travado por 2 minutos.</>
                      :
                        <><span style={{color: 'var(--accent)', fontWeight: 500}}>Mercado estável</span> — melhor altura para pedir. Preço mínimo activo.</>
                      }
                    </div>
                  </div>
                )}
              </div>

              <div className="ze-card">
                <div className="ze-section-title">parâmetros da corrida</div>
                <div className="ze-sl-row"><span className="ze-sl-label">Tarifa base B (Kz)</span><input type="range" min="100" max="800" value={pBase} step="50" onChange={e => setPBase(+e.target.value)} /><span className="ze-sl-val">{pBase} Kz</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Distância (km)</span><input type="range" min="1" max="50" value={pDist} step="1" onChange={e => setPDist(+e.target.value)} /><span className="ze-sl-val">{pDist} km</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Tempo (min)</span><input type="range" min="3" max="90" value={pTime} step="1" onChange={e => setPTime(+e.target.value)} /><span className="ze-sl-val">{pTime} min</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Preço/km r_d</span><input type="range" min="80" max="400" value={pRd} step="10" onChange={e => setPRd(+e.target.value)} /><span className="ze-sl-val">{pRd} Kz</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Preço/min r_t</span><input type="range" min="5" max="60" value={pRt} step="1" onChange={e => setPRt(+e.target.value)} /><span className="ze-sl-val">{pRt} Kz</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Taxa extra F (Kz)</span><input type="range" min="0" max="1000" value={pFees} step="50" onChange={e => setPFees(+e.target.value)} /><span className="ze-sl-val">{pFees} Kz</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Comissão Zenith</span><input type="range" min="5" max="20" value={pComm} step="1" onChange={e => setPComm(+e.target.value)} /><span className="ze-sl-val">{pComm}%</span></div>
                <div className="ze-divider"></div>
                <div className="ze-section-title">surge dinâmico — S = 1 + α × (D/O)</div>
                <div className="ze-sl-row"><span className="ze-sl-label">Demanda D</span><input type="range" min="1" max="100" value={pDemand} step="1" onChange={e => setPDemand(+e.target.value)} /><span className="ze-sl-val">{pDemand}</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Oferta O</span><input type="range" min="1" max="100" value={pSupply} step="1" onChange={e => setPSupply(+e.target.value)} /><span className="ze-sl-val">{pSupply}</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Agressividade α</span><input type="range" min="1" max="15" value={pAlpha} step="1" onChange={e => setPAlpha(+e.target.value)} /><span className="ze-sl-val">{alphaVal.toFixed(1)}</span></div>
              </div>

              {(mode === 'zenith' || mode === 'hybrid') && (
                <div className="ze-card">
                  <div className="ze-section-title">multiplicadores zenith</div>
                  <div className="ze-btn-group">
                    <button className="ze-btn-preset" onClick={() => setPreset('rain')}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>rainy</span> Chuva</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('event')}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>celebration</span> Evento</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('night')}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>dark_mode</span> Noite</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('premium')}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>apartment</span> Zona Premium</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('vip')}>⭐ VIP</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('bad')}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>warning</span> Mau Utilizador</button>
                    <button className="ze-btn-preset" onClick={() => setPreset('reset')}>↺ Reset</button>
                  </div>
                  <div className="ze-sl-row"><span className="ze-sl-label">W_l (zona)</span><input type="range" min="8" max="25" value={pWl} step="1" onChange={e => setPWl(+e.target.value)} /><span className="ze-sl-val">{(pWl/10).toFixed(1)}</span></div>
                  <div className="ze-sl-row"><span className="ze-sl-label">W_t (trânsito)</span><input type="range" min="8" max="25" value={pWt} step="1" onChange={e => setPWt(+e.target.value)} /><span className="ze-sl-val">{(pWt/10).toFixed(1)}</span></div>
                  <div className="ze-sl-row"><span className="ze-sl-label">C (contexto)</span><input type="range" min="8" max="25" value={pC} step="1" onChange={e => setPC(+e.target.value)} /><span className="ze-sl-val">{(pC/10).toFixed(1)}</span></div>
                  <div className="ze-sl-row"><span className="ze-sl-label">U (utilizador)</span><input type="range" min="5" max="15" value={pU} step="1" onChange={e => setPU(+e.target.value)} /><span className="ze-sl-val">{(pU/10).toFixed(1)}</span></div>
                </div>
              )}

              {mode === 'hybrid' && (
                <div className="ze-card">
                  <div className="ze-section-title">zona de negociação limitada</div>
                  <div className="ze-sl-row"><span className="ze-sl-label">Desconto máx (%)</span><input type="range" min="5" max="30" value={negoMin} step="5" onChange={e => setNegoMin(+e.target.value)} /><span className="ze-sl-val">-{negoMin}%</span></div>
                  <div className="ze-sl-row"><span className="ze-sl-label">Prémio máx (%)</span><input type="range" min="5" max="30" value={negoMax} step="5" onChange={e => setNegoMax(+e.target.value)} /><span className="ze-sl-val">+{negoMax}%</span></div>
                  <div className="ze-nego-bar">
                    <div className="ze-nego-zone" style={{ width: `${rW}%`, background: 'rgba(255,68,68,.2)', color: '#ff8080' }}>-{negoMin}%</div>
                    <div className="ze-nego-zone" style={{ width: `${gW}%`, background: 'rgba(0,230,118,.15)', color: 'var(--green)' }}>zona aceite</div>
                    <div className="ze-nego-zone" style={{ width: `${aW}%`, background: 'rgba(255,170,0,.2)', color: 'var(--amber)' }}>+{negoMax}%</div>
                  </div>
                  <div className="ze-grid3">
                    <div className="ze-metric"><div className="ze-metric-label">Mín. aceite</div><div className="ze-metric-val red">{fmt(fare * (1 - negoMin/100))} Kz</div></div>
                    <div className="ze-metric"><div className="ze-metric-label">Preço sugerido</div><div className="ze-metric-val">{fmt(fare)} Kz</div></div>
                    <div className="ze-metric"><div className="ze-metric-label">Máx. aceite</div><div className="ze-metric-val amber">{fmt(fare * (1 + negoMax/100))} Kz</div></div>
                  </div>
                  <div className="ze-insight" style={{marginTop: '10px'}}>
                    <div className="ze-insight-title">Lock de preço — estratégia psicológica</div>
                    <div className="ze-insight-body">Mostrar ao utilizador: <strong style={{color: 'var(--green)'}}>"Preço fixo por 2 minutos"</strong> — cria urgência e reduz abandono em 23%.</div>
                  </div>
                </div>
              )}

              <div className="ze-card">
                <div className="ze-section-title">breakdown por corrida</div>
                <div className="ze-grid4">
                  <div className="ze-metric"><div className="ze-metric-label">Tarifa bruta</div><div className="ze-metric-val">{fmt(fare)}</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">Tua comissão</div><div className="ze-metric-val green">{fmt(yourCut)}</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">Motorista recebe</div><div className="ze-metric-val blue">{fmt(driverCut)}</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">100 corridas/dia</div><div className="ze-metric-val green">{fmt(yourCut * 100)}</div></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'formula' && (
            <div>
              <div className="ze-card ze-accent-border">
                <div className="ze-section-title">fórmula base — uber / bolt / yango</div>
                <div className="ze-formula-box"><span className="hi">Fare</span> = <span className="hi">B</span> + (<span className="hi">d</span> × <span className="hi">r_d</span>) + (<span className="hi">t</span> × <span className="hi">r_t</span>) × <span className="hi">S</span> + <span className="hi">F</span></div>
                <div className="ze-explainer-grid">
                  <div className="ze-exp-item"><div className="ze-exp-var">B</div><div className="ze-exp-desc">Tarifa base de entrada. Em Luanda: 300 Kz.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">d × r_d</div><div className="ze-exp-desc">Distância × preço por km. Mercado: 182 Kz/km.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">t × r_t</div><div className="ze-exp-desc">Tempo × preço por minuto. Mercado: 15 Kz/min.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">S</div><div className="ze-exp-desc">Surge dinâmico. Calculado por D/O em tempo real.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">F</div><div className="ze-exp-desc">Taxas extras: noite, aeroporto, tráfego, etc.</div></div>
                </div>
              </div>

              <div className="ze-card ze-accent-border">
                <div className="ze-section-title">surge — o motor de lucro real</div>
                <div className="ze-formula-box"><span className="hi">S</span> = 1 + <span className="hi">α</span> × (<span className="hi">D</span> / <span className="hi">O</span>)</div>
                <div className="ze-explainer-grid">
                  <div className="ze-exp-item"><div className="ze-exp-var">D</div><div className="ze-exp-desc">Pedidos activos em tempo real na zona.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">O</div><div className="ze-exp-desc">Motoristas disponíveis na zona.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">α</div><div className="ze-exp-desc">Agressividade. 0.3 suave, 0.5 padrão, 0.8 agressivo.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">S máx</div><div className="ze-exp-desc">Recomendado: limitar a 2.5× para não assustar o utilizador.</div></div>
                </div>
                <div className="ze-insight ze-warn" style={{marginTop: '12px'}}>
                  <div className="ze-insight-title">Fórmula manual vs. surge real</div>
                  <div className="ze-insight-body">Fare = 300 + (3×182) + (60×15) × <strong>2.5</strong> + 500 usa S=2.5 fixo. Serve para testes rápidos, mas não para produção. Em produção o S deve ser calculado em tempo real com a fórmula acima.</div>
                </div>
              </div>

              <div className="ze-card ze-accent-border">
                <div className="ze-section-title">fórmula zenith avançada</div>
                <div className="ze-formula-box"><span className="hi">Fare</span> = B + (d × r_d × <span className="hi">W_l</span>) + (t × r_t × <span className="hi">W_t</span>) × S × <span className="hi">C</span> × <span className="hi">U</span> + F</div>
                <div className="ze-explainer-grid">
                  <div className="ze-exp-item"><div className="ze-exp-var">W_l</div><div className="ze-exp-desc">Location Weight. Talatona = 1.4×, periferia = 0.9×.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">W_t</div><div className="ze-exp-desc">Traffic Weight. Trânsito parado = 1.5×, livre = 1.0×.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">C</div><div className="ze-exp-desc">Context Factor. Chuva=1.4, evento=1.6, noite=1.2.</div></div>
                  <div className="ze-exp-item"><div className="ze-exp-var">U</div><div className="ze-exp-desc">User Factor. VIP=0.85, novo=1.0, problemático=1.3.</div></div>
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">comparação — o que cada modo suporta</div>
                <div style={{overflowX: 'auto'}}>
                  <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '12px'}}>
                    <thead>
                      <tr style={{borderBottom: '0.5px solid var(--border2)'}}>
                        <th style={{textAlign: 'left', padding: '8px', color: 'var(--text3)', fontWeight: 500, fontFamily: "'DM Mono',monospace", fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase'}}>Funcionalidade</th>
                        <th style={{padding: '8px', color: 'var(--text3)', fontWeight: 500, fontFamily: "'DM Mono',monospace", fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'center'}}>Base</th>
                        <th style={{padding: '8px', color: 'var(--green)', fontWeight: 500, fontFamily: "'DM Mono',monospace", fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'center'}}>Zenith</th>
                        <th style={{padding: '8px', color: 'var(--amber)', fontWeight: 500, fontFamily: "'DM Mono',monospace", fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'center'}}>Híbrido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Surge dinâmico (D/O)', true, true, true],
                        ['Tarifa base + km + min', true, true, true],
                        ['Taxas extras (F)', true, true, true],
                        ['W_l — peso por zona', false, true, true],
                        ['W_t — peso por trânsito', false, true, true],
                        ['C — factor contexto', false, true, true],
                        ['U — factor utilizador', false, true, true],
                        ['Negociação P2P limitada', false, false, true],
                        ['Lock de preço 2min', false, false, true],
                        ['Preço explicável', false, true, true],
                        ['Recomendação "espere"', false, true, true],
                        ['Opções Eco/Premium/Luxo', false, true, true]
                      ].map(([name, b, z, h], i) => (
                        <tr key={i} style={{borderBottom: '0.5px solid var(--border)'}}>
                          <td style={{padding: '6px 8px', color: 'var(--text2)'}}>{name as string}</td>
                          <td style={{textAlign: 'center', padding: '6px 8px', color: b ? '#00e676' : '#555550'}}>{b ? '✓' : '—'}</td>
                          <td style={{textAlign: 'center', padding: '6px 8px', color: z ? '#00e676' : '#555550'}}>{z ? '✓' : '—'}</td>
                          <td style={{textAlign: 'center', padding: '6px 8px', color: h ? '#ffaa00' : '#555550'}}>{h ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">roadmap recomendado</div>
                <div className="ze-phase-grid">
                  <div className="ze-phase-card">
                    <div className="ze-phase-num">01</div>
                    <div className="ze-phase-name">Lançamento</div>
                    <div className="ze-phase-kpi">Fórmula Base<br/>Surge simples<br/>Comissão: 8-10%<br/>Objectivo: massa crítica</div>
                  </div>
                  <div className="ze-phase-card">
                    <div className="ze-phase-num">02</div>
                    <div className="ze-phase-name">Crescimento</div>
                    <div className="ze-phase-kpi">Activar W_l + C<br/>Zonas premium<br/>Comissão: 11-12%<br/>Objectivo: receita</div>
                  </div>
                  <div className="ze-phase-card">
                    <div className="ze-phase-num">03</div>
                    <div className="ze-phase-name">Expansão</div>
                    <div className="ze-phase-kpi">Fórmula Zenith completa<br/>W_t + U activo<br/>Comissão: 12-13%<br/>Objectivo: diferenciação</div>
                  </div>
                  <div className="ze-phase-card">
                    <div className="ze-phase-num">04</div>
                    <div className="ze-phase-name">Domínio</div>
                    <div className="ze-phase-kpi">Modo Híbrido<br/>Negociação P2P limitada<br/>Planos VIP/Corp<br/>Objectivo: liderança</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'revenue' && (
            <div>
              <div className="ze-card">
                <div className="ze-section-title">projecção de receita</div>
                <div className="ze-sl-row"><span className="ze-sl-label">Corridas/dia</span><input type="range" min="10" max="5000" value={rRides} step="10" onChange={e => setRRides(+e.target.value)} /><span className="ze-sl-val">{rRides.toLocaleString('pt-AO')}</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Tarifa média (Kz)</span><input type="range" min="500" max="10000" value={rFare} step="100" onChange={e => setRFare(+e.target.value)} /><span className="ze-sl-val">{rFare.toLocaleString('pt-AO')}</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Comissão (%)</span><input type="range" min="5" max="20" value={rComm} step="1" onChange={e => setRComm(+e.target.value)} /><span className="ze-sl-val">{rComm}%</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Custo operacional</span><input type="range" min="5" max="70" value={rOpex} step="5" onChange={e => setROpex(+e.target.value)} /><span className="ze-sl-val">{rOpex}%</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">% Corridas surge</span><input type="range" min="0" max="80" value={rSurgePct} step="5" onChange={e => setRSurgePct(+e.target.value)} /><span className="ze-sl-val">{rSurgePct}%</span></div>
                <div className="ze-sl-row"><span className="ze-sl-label">Surge médio (×)</span><input type="range" min="10" max="30" value={rSurgeMult} step="1" onChange={e => setRSurgeMult(+e.target.value)} /><span className="ze-sl-val">{(rSurgeMult/10).toFixed(1)}×</span></div>
              </div>

              <div className="ze-grid2">
                <div className="ze-metric"><div className="ze-metric-label">GMV diário</div><div className="ze-metric-val">{fmt(gmvDay)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">GMV mensal</div><div className="ze-metric-val">{fmt(gmvDay * 30)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Receita bruta/dia</div><div className="ze-metric-val green">{fmt(grossDay)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Receita bruta/mês</div><div className="ze-metric-val green">{fmt(grossDay * 30)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Lucro líquido/dia</div><div className="ze-metric-val green">{fmt(netDay)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Lucro líquido/mês</div><div className="ze-metric-val green">{fmt(netDay * 30)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Bónus do surge/mês</div><div className="ze-metric-val amber">{fmt(surgeBonus * 30)} Kz</div></div>
                <div className="ze-metric"><div className="ze-metric-label">Margem líquida</div><div className="ze-metric-val">{margin}%</div></div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">crescimento por fase (projecção)</div>
                <div>
                  {phases.map((ph, i) => {
                    const n = Math.round(ph.r * rFare * (rComm / 100) * (1 - rOpex / 100) * 30);
                    const pct = maxNet > 0 ? Math.round((n / maxNet) * 100) : 0;
                    return (
                      <div key={i} className="ze-bar-row">
                        <span className="ze-bar-label" style={{ minWidth: '200px', fontSize: '11px' }}>{ph.label}</span>
                        <div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: `${pct}%`, background: ph.color }}></div></div>
                        <span className="ze-bar-val" style={{ minWidth: '120px' }}>{fmt(n)} Kz/mês</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">comparativo — comissões do mercado angolano</div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Heetch Angola</span><span className="ze-cmp-val">11.4%</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Yango Angola</span><span className="ze-cmp-val">13%</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Kubinga</span><span className="ze-cmp-val">25%</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">inDrive (promo lançamento)</span><span className="ze-badge ze-badge-red">0%</span></div>
                <div className="ze-cmp-row" style={{ paddingTop: '10px' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>Zenith</span>
                  <span className="ze-badge ze-badge-green">{rComm}%</span>
                </div>
              </div>

              <div className="ze-insight">
                <div className="ze-insight-title">Estratégia de comissão recomendada</div>
                <div className="ze-insight-body">Lança com <strong style={{ color: 'var(--green)' }}>8-10%</strong> para atrair motoristas e competir com inDrive. Aumenta para <strong style={{ color: 'var(--green)' }}>12-13%</strong> após atingir 1 000 corridas/dia — utilizadores e motoristas já estão fidelizados.</div>
              </div>
            </div>
          )}

          {activeTab === 'risk' && (
            <div>
              <div className="ze-card">
                <div className="ze-section-title">score de viabilidade zenith</div>
                <div className="ze-score-wrap">
                  <div className="ze-score-ring">
                    <svg width="80" height="80" viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="32" fill="none" stroke="#242424" strokeWidth="6" />
                      <circle cx="40" cy="40" r="32" fill="none" stroke="#00e676" strokeWidth="6" strokeDasharray="201" strokeDashoffset="60" strokeLinecap="round" />
                    </svg>
                    <div className="ze-score-num">70</div>
                  </div>
                  <div className="ze-score-desc">
                    <strong>Score: 70/100 — Viável com gestão de risco</strong><br />
                    O mercado angolano está em expansão, a competição está fragmentada, e há diferenciação real. O principal risco é regulatório e o comportamento do inDrive com 0% comissão.
                  </div>
                </div>
                <div className="ze-bar-row"><span className="ze-bar-label">Produto & tech</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '80%', background: 'var(--green)' }}></div></div><span className="ze-bar-val">80</span></div>
                <div className="ze-bar-row"><span className="ze-bar-label">Mercado Angola</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '72%', background: 'var(--green)' }}></div></div><span className="ze-bar-val">72</span></div>
                <div className="ze-bar-row"><span className="ze-bar-label">Diferenciação</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '85%', background: 'var(--green)' }}></div></div><span className="ze-bar-val">85</span></div>
                <div className="ze-bar-row"><span className="ze-bar-label">Risco regulatório</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '40%', background: 'var(--red)' }}></div></div><span className="ze-bar-val">40</span></div>
                <div className="ze-bar-row"><span className="ze-bar-label">Sustentabilidade</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '68%', background: 'var(--amber)' }}></div></div><span className="ze-bar-val">68</span></div>
                <div className="ze-bar-row"><span className="ze-bar-label">Capacidade financeira</span><div className="ze-bar-bg"><div className="ze-bar-fill" style={{ width: '60%', background: 'var(--amber)' }}></div></div><span className="ze-bar-val">60</span></div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">matriz de riscos</div>
                <div className="ze-risk-row"><span className="ze-risk-name">inDrive com 0% comissão por tempo longo — atrai motoristas</span><span className="ze-badge ze-badge-red">Crítico</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Regulação MINTRANS / licenças obrigatórias</span><span className="ze-badge ze-badge-red">Alto</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Yango expandir agressivamente com tech Yandex</span><span className="ze-badge ze-badge-red">Alto</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Dependência de 4G em zonas periféricas de Luanda</span><span className="ze-badge ze-badge-amber">Médio</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Fraude de motoristas — corridas fantasma / OTP bypass</span><span className="ze-badge ze-badge-amber">Médio</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Churn de motoristas nos primeiros 90 dias</span><span className="ze-badge ze-badge-amber">Médio</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Fluctuação do Kwanza (servidor USD/EUR)</span><span className="ze-badge ze-badge-amber">Médio</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Custo de aquisição de utilizadores alto (CAC)</span><span className="ze-badge ze-badge-amber">Médio</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Heetch a perder mercado — oportunidade de absorção</span><span className="ze-badge ze-badge-green">Oportunidade</span></div>
                <div className="ze-risk-row"><span className="ze-risk-name">Mercado de mobilidade angolano a crescer pós-2023</span><span className="ze-badge ze-badge-green">Oportunidade</span></div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">mitigações — acções concretas</div>
                <div className="ze-insight ze-danger">
                  <div className="ze-insight-title">vs. inDrive 0% comissão</div>
                  <div className="ze-insight-body">Lança com 8% de comissão + bónus de fidelidade para motoristas (ex: 500 Kz por 50 corridas completadas). O inDrive vai subir a comissão — quando isso acontecer, já tens motoristas fidelizados.</div>
                </div>
                <div className="ze-insight ze-danger">
                  <div className="ze-insight-title">vs. regulação MINTRANS</div>
                  <div className="ze-insight-body">Registar a empresa em Angola antes do lançamento. Contratar parceiro local com 3% (modelo Yango). Manter motoristas com carta e documentos verificados para evitar apreensões.</div>
                </div>
                <div className="ze-insight ze-warn">
                  <div className="ze-insight-title">vs. fraude</div>
                  <div className="ze-insight-body">OTP obrigatório no início de cada corrida. GPS tracking em tempo real. Limite de corridas por hora por motorista. Detecção de padrões suspeitos (mesma origem/destino repetida).</div>
                </div>
                <div className="ze-insight ze-warn">
                  <div className="ze-insight-title">vs. churn de motoristas</div>
                  <div className="ze-insight-body">Programa de pontos por corridas completas. Garantia mínima de 5 000 Kz/dia nas primeiras 8 semanas. App de motorista com painel de ganhos claro e transparente.</div>
                </div>
                <div className="ze-insight">
                  <div className="ze-insight-title">vs. Yango tech</div>
                  <div className="ze-insight-body">A tua vantagem não é a tecnologia — é o local e o preço justo. Foca na confiança: "preço explicável", zona de negociação, suporte em português angolano, pagamento Multicaixa Express.</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audience' && (
            <div>
              <div className="ze-card">
                <div className="ze-section-title">tamanho de mercado — Luanda</div>
                <div className="ze-grid4">
                  <div className="ze-metric"><div className="ze-metric-label">Pop. Luanda</div><div className="ze-metric-val">~9M</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">Utilizadores app (est.)</div><div className="ze-metric-val">~800K</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">Corridas/dia total mercado</div><div className="ze-metric-val">~50K</div></div>
                  <div className="ze-metric"><div className="ze-metric-label">Meta Zenith ano 1</div><div className="ze-metric-val green">2 500/dia</div></div>
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">segmentos de utilizadores</div>
                <div className="ze-seg-item"><div className="ze-seg-dot" style={{ background: '#378ADD' }}></div><span className="ze-seg-name">Classe média urbana (22-40 anos, smartphone Android)</span><span className="ze-seg-val">55%</span></div>
                <div className="ze-seg-item"><div className="ze-seg-dot" style={{ background: '#00e676' }}></div><span className="ze-seg-name">Expats e empresas (corpo diplomático, petrolíferas)</span><span className="ze-seg-val">20%</span></div>
                <div className="ze-seg-item"><div className="ze-seg-dot" style={{ background: 'var(--amber)' }}></div><span className="ze-seg-name">Estudantes universitários (frequência alta, preço baixo)</span><span className="ze-seg-val">15%</span></div>
                <div className="ze-seg-item"><div className="ze-seg-dot" style={{ background: '#D4537E' }}></div><span className="ze-seg-name">Turistas (crescimento pós-2023 visto livre)</span><span className="ze-seg-val">10%</span></div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">perfil do utilizador ideal (ICP)</div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Idade</span><span className="ze-cmp-val">22 – 40 anos</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Dispositivo</span><span className="ze-cmp-val">Android 10+ (dominante Angola)</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Pagamento preferido</span><span className="ze-cmp-val">Cash + Multicaixa Express</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Frequência</span><span className="ze-cmp-val">3 – 7 corridas / semana</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Principal dor</span><span className="ze-cmp-val">Preço imprevisível + segurança</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Zonas activas</span><span className="ze-cmp-val">Talatona · Miramar · Kilamba · Patriota</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Horários pico</span><span className="ze-cmp-val">07h-09h · 12h-14h · 17h-20h</span></div>
                <div className="ze-cmp-row"><span className="ze-cmp-label">Língua</span><span className="ze-cmp-val">Português angolano</span></div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">vantagem zenith por segmento</div>
                <div className="ze-insight">
                  <div className="ze-insight-title">Classe média — 55% do mercado</div>
                  <div className="ze-insight-body">Preço <strong style={{ color: 'var(--green)' }}>explicável</strong> (mostrar porquê subiu) + zona de negociação = sensação de controlo e justiça. Principal diferencial vs Yango e Heetch.</div>
                </div>
                <div className="ze-insight">
                  <div className="ze-insight-title">Expats / Empresas — 20% mas valor alto</div>
                  <div className="ze-insight-body">Plano <strong style={{ color: 'var(--green)' }}>Zenith Premium</strong>: motoristas verificados com foto, preço fixo por zona, pagamento por cartão, relatório mensal de deslocações para reembolso corporativo.</div>
                </div>
                <div className="ze-insight">
                  <div className="ze-insight-title">Estudantes — 15% do volume</div>
                  <div className="ze-insight-body">Factor U com <strong style={{ color: 'var(--green)' }}>desconto automático</strong> após 10 corridas. Programa de referência: 500 Kz por amigo que complete a primeira corrida.</div>
                </div>
                <div className="ze-insight">
                  <div className="ze-insight-title">Turistas — 10% mas crescente</div>
                  <div className="ze-insight-body">Interface em <strong style={{ color: 'var(--green)' }}>EN/PT</strong> + preço travado 2 minutos antes de confirmar + tarifas aeroporto fixas (sem surpresas). Parceria com hotéis de Luanda.</div>
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">estratégia de aquisição (go-to-market)</div>
                <div className="ze-phase-grid">
                  <div className="ze-phase-card">
                    <div className="ze-phase-num" style={{ fontSize: '20px', color: 'var(--blue)' }}>Motoristas</div>
                    <div className="ze-phase-name">Adquirir primeiro</div>
                    <div className="ze-phase-kpi">Meta: 200 motoristas activos<br />antes de lançar app pública.<br />Oferta: 0% comissão 60 dias<br />+ garantia mínima diária.</div>
                  </div>
                  <div className="ze-phase-card">
                    <div className="ze-phase-num" style={{ fontSize: '20px', color: 'var(--green)' }}>Passageiros</div>
                    <div className="ze-phase-name">Depois do supply</div>
                    <div className="ze-phase-kpi">Beta fechado em Talatona.<br />1ª corrida grátis.<br />Influencers locais de Luanda.<br />Parceria com centros comerciais.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'zonas' && (
            <div>
              <div className="ze-card accent-border">
                <div className="ze-section-title">tarifas fixas por par de zonas</div>
                <div className="ze-db-linha">
                  <span className={`ze-db-ponto ze-db-ponto--${estadoZonas}`}></span>
                  <span className="ze-db-texto">{textoZonas}</span>
                </div>
                <div className="ze-btn-group" style={{ marginTop: '12px', marginBottom: 0 }}>
                  <button
                    className={`ze-btn ${Object.keys(alteradas).length > 0 ? 'active' : ''}`}
                    onClick={guardarZonas}
                    disabled={estadoZonas === 'a-carregar' || estadoZonas === 'a-guardar'}
                  >
                    {estadoZonas === 'a-guardar' ? 'A guardar…' : 'Guardar alterações'}
                  </button>
                  <button
                    className="ze-btn"
                    onClick={usarFormulaEmTodas}
                    disabled={estadoZonas === 'a-carregar'}
                  >
                    Preencher todas com a fórmula
                  </button>
                  <button
                    className="ze-btn"
                    onClick={lerZonas}
                    disabled={estadoZonas === 'a-carregar'}
                  >
                    Recarregar
                  </button>
                </div>
                <div className="ze-insight-body" style={{ marginTop: '10px' }}>
                  Estas tarifas <strong>têm prioridade sobre o motor de preço</strong>: quando existe
                  um par de zonas, é este valor que o passageiro paga — no app e no bot do WhatsApp.
                  A coluna "Fórmula" mostra o que o motor cobraria para a mesma viagem.
                  {abaixoDaFormula > 0 && (
                    <>
                      {' '}
                      <strong className="ze-delta-baixo">
                        {abaixoDaFormula} tarifas estão mais de 5% abaixo da fórmula.
                      </strong>
                    </>
                  )}
                </div>
                {msgZonas && (
                  <div className={estadoZonas === 'erro' ? 'ze-db-erro' : 'ze-db-ok'}>{msgZonas}</div>
                )}
              </div>

              <div className="ze-card">
                <div className="ze-tbl-wrap">
                  <table className="ze-tbl">
                    <thead>
                      <tr>
                        <th>Origem</th>
                        <th>Destino</th>
                        <th>Dist. km</th>
                        <th>Preço fixo</th>
                        <th>Fórmula</th>
                        <th>Zona</th>
                        <th>Activa</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l) => {
                        const fixo = precoDe(l);
                        const d = desvioPct(fixo, l.formula_price_kz);
                        const sujo = Boolean(alteradas[l.id]);
                        const classeDelta =
                          d == null ? '' : d < -5 ? 'ze-delta-baixo' : d > 5 ? 'ze-delta-cima' : 'ze-delta-ok';
                        return (
                          <tr
                            key={l.id}
                            className={`${sujo ? 'dirty' : ''} ${activaDe(l) ? '' : 'off'}`}
                          >
                            <td>{l.origin_zone}</td>
                            <td>{l.dest_zone}</td>
                            <td>
                              <input
                                className="ze-num"
                                type="number"
                                min="0"
                                step="0.5"
                                value={distDe(l)}
                                onChange={(e) => editarZona(l.id, 'distance_km', +e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                className="ze-num"
                                type="number"
                                min="0"
                                step="50"
                                value={fixo}
                                onChange={(e) => editarZona(l.id, 'price_kz', +e.target.value)}
                              />
                            </td>
                            <td className="ze-formula">
                              {l.formula_price_kz == null ? '—' : fmt(l.formula_price_kz)}
                              {d != null && (
                                <span className={classeDelta}>
                                  {' '}
                                  {d > 0 ? '+' : ''}
                                  {d}%
                                </span>
                              )}
                            </td>
                            <td>{l.zone_multiplier != null ? `${l.zone_multiplier}×` : '—'}</td>
                            <td>
                              <input
                                type="checkbox"
                                checked={activaDe(l)}
                                onChange={(e) => editarZona(l.id, 'active', e.target.checked)}
                              />
                            </td>
                            <td>
                              <button
                                className="ze-mini"
                                onClick={() => usarFormula(l)}
                                disabled={l.formula_price_kz == null}
                              >
                                usar fórmula
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {estadoZonas === 'a-carregar' && (
                  <div className="ze-db-texto" style={{ marginTop: '10px' }}>
                    A carregar…
                  </div>
                )}
                {estadoZonas !== 'a-carregar' && linhas.length === 0 && (
                  <div className="ze-db-texto" style={{ marginTop: '10px' }}>
                    Não há tarifas fixas. O motor de preço trata de todas as viagens.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <div className="ze-card accent-border">
                <div className="ze-section-title">ligação ao motor de preço</div>
                <div className="ze-db-linha">
                  <span className={`ze-db-ponto ze-db-ponto--${estadoDb}`}></span>
                  <span className="ze-db-texto">{textoEstado}</span>
                </div>
                <div className="ze-btn-group" style={{ marginTop: '12px', marginBottom: 0 }}>
                  <button
                    className={`ze-btn ${porGuardar ? 'active' : ''}`}
                    onClick={guardarPrecos}
                    disabled={estadoDb === 'a-carregar' || estadoDb === 'a-guardar'}
                  >
                    {estadoDb === 'a-guardar' ? 'A guardar…' : porGuardar ? 'Guardar preços •' : 'Guardar preços'}
                  </button>
                  <button
                    className="ze-btn"
                    onClick={recarregar}
                    disabled={estadoDb === 'a-carregar' || estadoDb === 'a-guardar'}
                  >
                    Recarregar
                  </button>
                </div>
                <div className="ze-insight-body" style={{ marginTop: '10px' }}>
                  Estes valores são a linha activa de <strong>pricing_config</strong> — a mesma que a
                  função <strong>calculate_fare_engine_pro</strong> usa para cobrar. O app, o bot do
                  WhatsApp e o Kaze apanham a alteração no pedido seguinte, sem deploy.
                </div>
                {msgDb && <div className="ze-db-erro">{msgDb}</div>}
              </div>

              <div className="ze-card">
                <div className="ze-section-title">tarifa base</div>
                {linhaSlider('Tarifa base B', 'base_fare_kz', { min: 100, max: 1000, step: 50, sufixo: 'Kz' })}
                {linhaSlider('Preço/km r_d', 'rate_per_km_kz', { min: 50, max: 500, step: 10, sufixo: 'Kz' })}
                {linhaSlider('Preço/min r_t', 'rate_per_min_kz', { min: 5, max: 80, step: 1, sufixo: 'Kz' })}
                {linhaSlider('Surge máximo', 'surge_max', { min: 15, max: 50, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Alpha (α) do surge', 'surge_alpha', { min: 1, max: 15, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '' })}
                <div className="ze-divider"></div>
                <div className="ze-section-title">trânsito e comissão</div>
                {linhaSlider('Limiar de trânsito', 'traffic_threshold', { min: 10, max: 30, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Comissão da plataforma', 'platform_commission', { min: 0, max: 30, step: 1, escala: 100, exibir: 1, dec: 0, sufixo: '%' })}
              </div>

              <div className="ze-card">
                <div className="ze-section-title">pesos de zona (W_l)</div>
                {linhaSlider('Talatona', 'wl_talatona', { min: 10, max: 25, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Miramar', 'wl_miramar', { min: 10, max: 20, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Alvalade', 'wl_alvalade', { min: 10, max: 20, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Patriota', 'wl_patriota', { min: 10, max: 25, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Viana', 'wl_viana', { min: 7, max: 12, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Cacuaco', 'wl_cacuaco', { min: 7, max: 12, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Outras zonas', 'wl_default', { min: 7, max: 20, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
              </div>

              <div className="ze-card">
                <div className="ze-section-title">escalões de serviço (C)</div>
                {linhaSlider('Padrão', 'wl_standard', { min: 7, max: 20, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Premium', 'wl_premium', { min: 10, max: 30, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                {linhaSlider('Económico', 'wl_eco', { min: 5, max: 15, step: 1, escala: 10, exibir: 0.1, dec: 1, sufixo: '×' })}
                <div className="ze-divider"></div>
                <div className="ze-section-title">escalões de utilizador (U)</div>
                {linhaSlider('Normal', 'u_standard', { min: 50, max: 150, step: 1, escala: 100, exibir: 0.01, dec: 2, sufixo: '×' })}
                {linhaSlider('Novo', 'u_new', { min: 50, max: 150, step: 1, escala: 100, exibir: 0.01, dec: 2, sufixo: '×' })}
                {linhaSlider('VIP', 'u_vip', { min: 50, max: 120, step: 1, escala: 100, exibir: 0.01, dec: 2, sufixo: '×' })}
                {linhaSlider('Problemático', 'u_problematic', { min: 100, max: 200, step: 1, escala: 100, exibir: 0.01, dec: 2, sufixo: '×' })}
              </div>

              <div className="ze-card">
                <div className="ze-section-title">funcionalidades activas</div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Preço explicável ("porquê subiu")</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.explain} onChange={e => setFeatures({ ...features, explain: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Lock de preço (2 minutos)</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.lock} onChange={e => setFeatures({ ...features, lock: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Recomendação "espere 3 min"</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.rec} onChange={e => setFeatures({ ...features, rec: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Surge cap (máximo {precos.surge_max.toFixed(1)}×)</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.cap} onChange={e => setFeatures({ ...features, cap: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Factor U (utilizador VIP/problemático)</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.user} onChange={e => setFeatures({ ...features, user: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Preço psicológico (ex: 1 999 em vez de 2 000)</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.psych} onChange={e => setFeatures({ ...features, psych: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
                <div className="ze-toggle-wrap">
                  <span className="ze-toggle-label">Opções Económico / Premium / Zenith Luxo</span>
                  <label className="ze-toggle"><input type="checkbox" checked={features.tiers} onChange={e => setFeatures({ ...features, tiers: e.target.checked })} /><div className="ze-toggle-track"></div><div className="ze-toggle-thumb"></div></label>
                </div>
              </div>

              <div className="ze-card">
                <div className="ze-section-title">taxas extras configuráveis (F)</div>
                {linhaSlider('Taxa nocturna', 'fee_night_kz', { min: 0, max: 500, step: 50, sufixo: 'Kz' })}
                {linhaSlider('Taxa aeroporto', 'fee_airport_kz', { min: 0, max: 1000, step: 50, sufixo: 'Kz' })}
                {linhaSlider('Taxa tráfego intenso', 'fee_traffic_kz', { min: 0, max: 300, step: 50, sufixo: 'Kz' })}
                {linhaSlider('Taxa de cancelamento', 'fee_cancel_kz', { min: 0, max: 500, step: 50, sufixo: 'Kz' })}
              </div>

              <div className="ze-insight">
                <div className="ze-insight-title">O que grava e o que não grava</div>
                <div className="ze-insight-body">
                  <strong>Grava:</strong> todos os sliders desta página vão para a tabela
                  <strong> pricing_config</strong> quando carregas em "Guardar preços". É de lá que o
                  motor de preço lê, por isso a alteração chega ao app, ao bot do WhatsApp e ao Kaze
                  no pedido seguinte.
                  <br /><br />
                  <strong>Não grava:</strong> os interruptores de "Funcionalidades activas" são
                  apenas desta calculadora — não têm coluna na base de dados. As tarifas fixas por
                  par de zonas vivem noutra tabela (<strong>zone_prices</strong>), que esta página
                  ainda não edita.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
