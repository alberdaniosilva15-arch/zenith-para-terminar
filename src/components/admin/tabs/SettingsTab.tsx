import React, { useEffect, useState } from 'react';
import {
  DEFAULT_MODELS_BY_PROVIDER,
  LOCAL_KAZE_URL,
  LS_IA_BASE_URL,
  LS_IA_MODEL,
  LS_IA_MODELS_CACHE,
  LS_IA_PROVIDER,
  PROVIDERS,
  getAiModelSettings,
  getDefaultModel,
  getProviderBaseUrl,
  getStored,
  normalizeProvider,
  setStored,
  type AiModelOption,
  type AiProvider,
} from '../../../lib/aiModelSettings';
import { kazeSpeak } from '../../../lib/kazeVoice';

function readCachedModels(provider: AiProvider): AiModelOption[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_IA_MODELS_CACHE) || '{}');
    const cached = parsed?.[provider];
    return Array.isArray(cached) ? cached.filter((model) => model?.id && model?.label) : [];
  } catch {
    return [];
  }
}

function writeCachedModels(provider: AiProvider, models: AiModelOption[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_IA_MODELS_CACHE) || '{}');
    localStorage.setItem(LS_IA_MODELS_CACHE, JSON.stringify({ ...parsed, [provider]: models }));
  } catch { console.debug('Failed to write cached models') }
}

function initialModels(provider: AiProvider) {
  const cached = readCachedModels(provider);
  return cached.length > 0 ? cached : (DEFAULT_MODELS_BY_PROVIDER[provider] ?? []);
}

export const SettingsTab: React.FC = () => {
  // --- IA Provider ---
  const [iaProvider, setIaProvider] = useState<AiProvider>(() => getAiModelSettings().provider);
  const [iaModel, setIaModel] = useState(() => getAiModelSettings().model);
  const [iaApiKey, setIaApiKey] = useState(() => getAiModelSettings().apiKey);
  const [iaBaseUrl, setIaBaseUrl] = useState(() => getAiModelSettings().baseUrl);
  const [iaModels, setIaModels] = useState<AiModelOption[]>(() => initialModels(getAiModelSettings().provider));
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState('');
  const [iaSaved, setIaSaved] = useState(false);

  // --- Voz do Kaze ---
  //  A voz vem do Gemini (acção `kaze_tts` no `gemini-proxy`, voz Aoede), igual
  //  à da sessão Live. Não há nada para escolher aqui: a voz é a mesma em todos
  //  os aparelhos. O antigo selector de vozes do dispositivo foi removido por
  //  ser enganador — o botão "Testar" tocava sempre a voz do Gemini, ignorando
  //  o que estivesse escolhido na lista.
  const [voiceTesting, setVoiceTesting] = useState(false);
  /**
   * Resultado do último teste de voz. Sem isto, um botão que falha fica mudo e
   * a única informação disponível é "não se ouviu nada" — que tanto pode ser o
   * servidor a recusar, como o Live a mandar, como o browser a bloquear o som.
   */
  const [voiceTestMsg, setVoiceTestMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const fetchIaModels = async () => {
    const provider = normalizeProvider(iaProvider);
    const apiKey = iaApiKey.trim();
    const baseUrl = getProviderBaseUrl(provider, iaBaseUrl);

    if (!apiKey && provider !== 'openrouter') {
      setIaError('Introduz a API key primeiro.');
      return;
    }

    setIaLoading(true);
    setIaError('');

    try {
      const res = await fetch(`${LOCAL_KAZE_URL}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseUrl }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const models: AiModelOption[] = (Array.isArray(data.models) ? data.models : [])
        .filter((model: AiModelOption) => model?.id)
        .map((model: AiModelOption) => ({ id: model.id, label: model.label || model.id }));
      if (models.length === 0) throw new Error('A API nao devolveu modelos compativeis.');

      setIaModels(models);
      writeCachedModels(provider, models);
      if (!models.some((model) => model.id === iaModel)) {
        setIaModel(models[0]?.id ?? getDefaultModel(provider));
      }
    } catch (e: any) {
      setIaError(e?.message || 'Falha ao carregar modelos da API.');
    } finally {
      setIaLoading(false);
    }
  };

  const saveIaSettings = () => {
    setStored(LS_IA_PROVIDER, iaProvider);
    setStored(LS_IA_MODEL, iaModel);
    setStored(LS_IA_BASE_URL, getProviderBaseUrl(iaProvider, iaBaseUrl));
    setIaSaved(true);
    setTimeout(() => setIaSaved(false), 2000);
  };

  /**
   * Toca a voz REAL do Kaze — a mesma que o utilizador ouve.
   *
   * Antes isto guardava a voz escolhida numa lista do dispositivo e só depois
   * falava; como a fala já vinha do Gemini, a escolha não tinha efeito nenhum.
   * Agora só há uma voz, e este botão serve para confirmar que ela está viva.
   */
  const testVoice = async () => {
    setVoiceTesting(true);
    setVoiceTestMsg(null);
    try {
      const r = await kazeSpeak('Kaze operacional. Núcleo sincronizado. Pronto para servir.');

      if (r?.source === 'gemini_tts') {
        setVoiceTestMsg({ ok: true, texto: 'Voz do Gemini a tocar. Está operacional.' });
        return;
      }

      const razoes: Record<string, string> = {
        texto_vazio: 'O texto ficou vazio depois da limpeza.',
        live_activo:
          'Há uma sessão de Voz Ao Vivo aberta — a voz pertence-lhe. Fecha-a e tenta outra vez.',
        sem_web_audio: 'Este browser não disponibilizou o Web Audio.',
        servidor: 'O servidor recusou a síntese.',
        audio_vazio: 'O servidor respondeu, mas sem áudio.',
        substituido: 'A fala foi substituída ou cortada antes de tocar.',
      };
      const base = razoes[r?.motivo ?? ''] ?? 'Não se ouviu nada e não ficou motivo registado.';
      setVoiceTestMsg({
        ok: false,
        texto: r?.detalhe ? `${base} Resposta do servidor: ${r.detalhe}` : base,
      });
    } finally {
      setVoiceTesting(false);
    }
  };

  const availableModels = iaModels.length > 0 ? iaModels : (DEFAULT_MODELS_BY_PROVIDER[iaProvider] ?? []);

  return (
    <div className="w-full h-full overflow-y-auto px-margin-desktop py-lg max-w-[1200px] mx-auto pb-24 bg-[#000000]">
      <div className="mb-xl">
        <h2 className="font-headline-xl text-on-surface tracking-tight">Definicoes</h2>
        <p className="font-body-md text-on-surface-variant mt-2">Configuracao de APIs, modelos de IA e voz do Kaze.</p>
      </div>

      <div className="space-y-8">

        {/* ========== VOZ DO KAZE ========== */}
        {/*  A voz do Kaze vem do Gemini, não do aparelho. Esta secção dizia o
             contrário ("usa a voz instalada no teu telemóvel, sem APIs
             externas") e oferecia um selector de vozes do sistema que o botão
             "Testar" ignorava por completo — tocava sempre a voz do Gemini.
             Não há nada para escolher: a voz é a mesma em todos os aparelhos. */}
        <section className="rounded-xl border border-primary/15 bg-[#050505]/85 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="material-symbols-outlined text-primary">spatial_audio</span>
            <h3 className="font-headline-lg text-on-surface tracking-tight">Voz do Kaze</h3>
          </div>

          <p className="text-xs text-on-surface-variant mb-4">
            A voz do Kaze é gerada pelo <strong className="text-on-surface">Gemini</strong> — voz{' '}
            <code className="text-primary">Aoede</code>, a mesma da sessão de Voz Ao Vivo. É
            igual em todos os aparelhos, porque não depende da voz instalada no telemóvel.
          </p>

          <div className="grid gap-4 md:grid-cols-2 mb-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Modelo</span>
              <span className="text-sm text-on-surface">Gemini TTS</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Voz</span>
              <span className="text-sm text-on-surface">Aoede (pt-PT)</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => { void testVoice(); }}
              disabled={voiceTesting}
              className="px-4 py-2 border border-primary/20 rounded text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors text-xs uppercase tracking-widest disabled:opacity-40"
            >
              {voiceTesting ? 'A falar...' : '🔊 Ouvir voz do Kaze'}
            </button>
            <span className="text-xs text-on-surface-variant">
              A configuração da voz é feita no servidor, por variável de ambiente.
            </span>
          </div>

          {voiceTestMsg && (
            <p
              className="mt-4 text-xs leading-relaxed"
              style={{ color: voiceTestMsg.ok ? '#4ade80' : '#f87171' }}
              role="status"
            >
              {voiceTestMsg.ok ? '✓ ' : '✕ '}
              {voiceTestMsg.texto}
            </p>
          )}
        </section>

        {/* ========== AI PROVIDER ========== */}
        <section className="rounded-xl border border-primary/15 bg-[#050505]/85 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="material-symbols-outlined text-primary">model_training</span>
            <h3 className="font-headline-lg text-on-surface tracking-tight">Modelo de IA</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Fornecedor</span>
              <select
                value={iaProvider}
                onChange={(e) => {
                  const nextProvider = normalizeProvider(e.target.value);
                  const nextModels = initialModels(nextProvider);
                  setIaProvider(nextProvider);
                  setIaModels(nextModels);
                  setIaModel(nextModels[0]?.id ?? getDefaultModel(nextProvider));
                  setIaBaseUrl(getProviderBaseUrl(nextProvider));
                  setIaError('');
                }}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Modelo</span>
              <select
                value={iaModel}
                onChange={(e) => setIaModel(e.target.value)}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">API Key</span>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={iaApiKey}
                  onChange={(e) => setIaApiKey(e.target.value)}
                  className="flex-1 bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none font-mono"
                  placeholder="sk-... / AIza..."
                />
                <button
                  onClick={() => void fetchIaModels()}
                  disabled={iaLoading}
                  className="px-4 py-2 border border-primary/30 rounded text-primary hover:bg-primary hover:text-[#000000] transition-colors text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {iaLoading ? '...' : 'Ligar'}
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Base URL</span>
              <input
                value={iaBaseUrl}
                onChange={(e) => setIaBaseUrl(e.target.value)}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none font-mono"
                placeholder="https://api.openai.com/v1"
              />
            </label>
          </div>

          {iaError && <p className="mt-3 text-xs text-red-400">{iaError}</p>}

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={saveIaSettings}
              className="px-5 py-2 bg-primary text-[#000000] rounded font-bold text-xs uppercase tracking-widest hover:bg-primary-fixed transition-colors"
            >
              {iaSaved ? '✓ Guardado' : 'Guardar Modelo'}
            </button>
            <span className="text-xs text-on-surface-variant">
              {availableModels.length} modelos disponiveis para este fornecedor.
            </span>
          </div>
        </section>

      </div>
    </div>
  );
};
