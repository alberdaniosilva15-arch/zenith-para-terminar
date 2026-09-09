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
import {
  getAvailablePortugueseVoices,
  setNativeVoice,
  kazeSpeak,
  isVoiceReady,
} from '../../../lib/kazeVoice';

interface NativeVoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
  isDefault: boolean;
}

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

  // --- Voz Nativa do Dispositivo ---
  const [nativeVoices, setNativeVoices] = useState<NativeVoiceOption[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [voiceReady] = useState(() => isVoiceReady());
  const [voicesLoading, setVoicesLoading] = useState(true);

  // Carregar vozes portuguesas do dispositivo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const voices = await getAvailablePortugueseVoices();
        if (cancelled) return;
        setNativeVoices(
          voices.map((v) => ({
            name: v.name,
            lang: v.lang,
            voiceURI: v.voiceURI,
            isDefault: v.default,
          }))
        );
        // Pre-seleccionar a voz guardada no cache
        const cached = localStorage.getItem('kaze_native_voice_uri');
        if (cached && voices.some((v) => v.voiceURI === cached)) {
          setSelectedVoiceURI(cached);
        } else if (voices.length > 0 && voices[0]) {
          setSelectedVoiceURI(voices[0].voiceURI);
        }
      } catch { /* sem vozes */ }
      if (!cancelled) setVoicesLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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

  const saveVoiceSettings = () => {
    if (!selectedVoiceURI) return;
    setNativeVoice(selectedVoiceURI);
    setVoiceSaved(true);
    setTimeout(() => setVoiceSaved(false), 2000);
  };

  const testVoice = () => {
    if (!selectedVoiceURI) return;
    // Guardar temporariamente para teste
    setNativeVoice(selectedVoiceURI);
    void kazeSpeak('Kaze operacional. Núcleo sincronizado. Pronto para servir.');
  };

  const availableModels = iaModels.length > 0 ? iaModels : (DEFAULT_MODELS_BY_PROVIDER[iaProvider] ?? []);

  return (
    <div className="w-full h-full overflow-y-auto px-margin-desktop py-lg max-w-[1200px] mx-auto pb-24 bg-[#000000]">
      <div className="mb-xl">
        <h2 className="font-headline-xl text-on-surface tracking-tight">Definicoes</h2>
        <p className="font-body-md text-on-surface-variant mt-2">Configuracao de APIs, modelos de IA e voz do Kaze.</p>
      </div>

      <div className="space-y-8">

        {/* ========== VOZ NATIVA DO DISPOSITIVO ========== */}
        <section className="rounded-xl border border-primary/15 bg-[#050505]/85 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="material-symbols-outlined text-primary">spatial_audio</span>
            <h3 className="font-headline-lg text-on-surface tracking-tight">Voz do Kaze (Nativa do Dispositivo)</h3>
          </div>

          <p className="text-xs text-on-surface-variant mb-4">
            O Kaze usa a voz instalada no teu telemóvel. Sem APIs externas, sem custos. A voz é selecionada automaticamente
            {voiceReady ? ' — ✓ já configurada.' : ' na primeira utilização.'}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Voz Portuguesa</span>
              <select
                value={selectedVoiceURI}
                onChange={(e) => setSelectedVoiceURI(e.target.value)}
                disabled={voicesLoading}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none disabled:opacity-40"
              >
                {voicesLoading && <option value="">A carregar vozes...</option>}
                {!voicesLoading && nativeVoices.length === 0 && <option value="">Nenhuma voz portuguesa encontrada</option>}
                {nativeVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang}){v.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2 justify-end">
              <button
                onClick={testVoice}
                disabled={!selectedVoiceURI}
                className="px-4 py-2 border border-primary/20 rounded text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors text-xs uppercase tracking-widest disabled:opacity-40"
              >
                🔊 Testar Voz
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={saveVoiceSettings}
              disabled={!selectedVoiceURI}
              className="px-5 py-2 bg-primary text-[#000000] rounded font-bold text-xs uppercase tracking-widest hover:bg-primary-fixed transition-colors disabled:opacity-50"
            >
              {voiceSaved ? '✓ Guardado' : 'Guardar Voz'}
            </button>
            <span className="text-xs text-on-surface-variant">
              {voicesLoading ? 'A detectar...' : `${nativeVoices.length} vozes portuguesas disponíveis`}
            </span>
          </div>
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
