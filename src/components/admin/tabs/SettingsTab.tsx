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

const LS_ELEVENLABS_KEY = 'zenith_elevenlabs_api_key';
const LS_ELEVENLABS_VOICE = 'zenith_elevenlabs_voice_id';
const LS_KAZE_VOICE = 'kaze_voice_preference';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

interface SystemVoiceOption {
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
  // --- ElevenLabs ---
  const [elevenKey, setElevenKey] = useState(() => getStored(LS_ELEVENLABS_KEY));
  const [elevenVoices, setElevenVoices] = useState<ElevenLabsVoice[]>([]);
  const [elevenVoiceId, setElevenVoiceId] = useState(() => getStored(LS_ELEVENLABS_VOICE));
  const [elevenLoading, setElevenLoading] = useState(false);
  const [elevenError, setElevenError] = useState('');
  const [elevenSaved, setElevenSaved] = useState(false);

  // --- IA Provider ---
  const [iaProvider, setIaProvider] = useState<AiProvider>(() => getAiModelSettings().provider);
  const [iaModel, setIaModel] = useState(() => getAiModelSettings().model);
  const [iaApiKey, setIaApiKey] = useState(() => getAiModelSettings().apiKey);
  const [iaBaseUrl, setIaBaseUrl] = useState(() => getAiModelSettings().baseUrl);
  const [iaModels, setIaModels] = useState<AiModelOption[]>(() => initialModels(getAiModelSettings().provider));
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState('');
  const [iaSaved, setIaSaved] = useState(false);

  // --- System Voices ---
  const [systemVoices, setSystemVoices] = useState<SystemVoiceOption[]>([]);
  const [selectedSystemVoice, setSelectedSystemVoice] = useState(() => getStored(LS_KAZE_VOICE, 'pt-PT-DuarteNeural'));
  const [voiceSaved, setVoiceSaved] = useState(false);

  // Load system voices
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const ptVoices = voices
        .filter((v) => v.lang.startsWith('pt') || v.lang.startsWith('en'))
        .map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, isDefault: v.default }));
      setSystemVoices(ptVoices);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Fetch ElevenLabs voices when key changes
  const fetchElevenVoices = async () => {
    const key = elevenKey.trim();
    if (!key) { setElevenError('Introduz a API key primeiro.'); return; }

    setElevenLoading(true);
    setElevenError('');

    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} — verifica se a key esta correcta.`);

      const data = await res.json();
      setElevenVoices(data.voices ?? []);
    } catch (e: any) {
      setElevenError(e?.message || 'Falha ao ligar a ElevenLabs.');
      setElevenVoices([]);
    } finally {
      setElevenLoading(false);
    }
  };

  const saveElevenLabs = () => {
    setStored(LS_ELEVENLABS_KEY, elevenKey.trim());
    setStored(LS_ELEVENLABS_VOICE, elevenVoiceId);
    setElevenSaved(true);
    setTimeout(() => setElevenSaved(false), 2000);
  };

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
    setStored(LS_KAZE_VOICE, selectedSystemVoice);
    setVoiceSaved(true);
    setTimeout(() => setVoiceSaved(false), 2000);
  };

  const testSystemVoice = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance('Kaze operacional. Nucleo sincronizado.');
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.voiceURI === selectedSystemVoice || v.name === selectedSystemVoice);
    if (match) {
      utterance.voice = match;
      utterance.lang = match.lang;
    } else {
      utterance.lang = 'pt-PT';
    }
    utterance.rate = 1.0;
    utterance.pitch = 0.9;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  const availableModels = iaModels.length > 0 ? iaModels : (DEFAULT_MODELS_BY_PROVIDER[iaProvider] ?? []);

  return (
    <div className="w-full h-full overflow-y-auto px-margin-desktop py-lg max-w-[1200px] mx-auto pb-24 bg-[#000000]">
      <div className="mb-xl">
        <h2 className="font-headline-xl text-on-surface tracking-tight">Definicoes</h2>
        <p className="font-body-md text-on-surface-variant mt-2">Configuracao de APIs, modelos de IA e voz do Kaze.</p>
      </div>

      <div className="space-y-8">

        {/* ========== VOICE API (ElevenLabs) ========== */}
        <section className="rounded-xl border border-primary/15 bg-[#050505]/85 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="material-symbols-outlined text-primary">record_voice_over</span>
            <h3 className="font-headline-lg text-on-surface tracking-tight">API de Voz: ElevenLabs</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">API Key</span>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={elevenKey}
                  onChange={(e) => setElevenKey(e.target.value)}
                  className="flex-1 bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none font-mono"
                  placeholder="sk-..."
                />
                <button
                  onClick={() => void fetchElevenVoices()}
                  disabled={elevenLoading}
                  className="px-4 py-2 bg-primary text-[#000000] rounded font-bold text-xs uppercase tracking-widest hover:bg-primary-fixed transition-colors disabled:opacity-50"
                >
                  {elevenLoading ? '...' : 'Ligar'}
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Voz ElevenLabs</span>
              <select
                value={elevenVoiceId}
                onChange={(e) => setElevenVoiceId(e.target.value)}
                disabled={elevenVoices.length === 0}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none disabled:opacity-40"
              >
                <option value="">Selecionar voz</option>
                {elevenVoices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name} {v.labels?.gender ? `(${v.labels.gender})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {elevenError && <p className="mt-3 text-xs text-red-400">{elevenError}</p>}

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={saveElevenLabs}
              className="px-5 py-2 bg-primary text-[#000000] rounded font-bold text-xs uppercase tracking-widest hover:bg-primary-fixed transition-colors"
            >
              {elevenSaved ? '✓ Guardado' : 'Guardar'}
            </button>
            <span className="text-xs text-on-surface-variant">
              {elevenVoices.length > 0 ? `${elevenVoices.length} vozes encontradas` : 'Clica "Ligar" para carregar vozes'}
            </span>
          </div>
        </section>

        {/* ========== SYSTEM VOICE (SAPI) ========== */}
        <section className="rounded-xl border border-primary/15 bg-[#050505]/85 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="material-symbols-outlined text-primary">spatial_audio</span>
            <h3 className="font-headline-lg text-on-surface tracking-tight">Voz Local do Sistema (Windows)</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-on-surface-variant">Voz do sistema</span>
              <select
                value={selectedSystemVoice}
                onChange={(e) => setSelectedSystemVoice(e.target.value)}
                className="bg-[#0A0A0A] border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
              >
                {systemVoices.length === 0 && <option value="">Nenhuma voz encontrada</option>}
                {systemVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang}) {v.isDefault ? <span className="material-symbols-outlined" style={{fontSize:'inherit',verticalAlign:'middle'}}>star</span> : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2 justify-end">
              <button
                onClick={testSystemVoice}
                className="px-4 py-2 border border-primary/20 rounded text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors text-xs uppercase tracking-widest"
              >
                Testar Voz
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={saveVoiceSettings}
              className="px-5 py-2 bg-primary text-[#000000] rounded font-bold text-xs uppercase tracking-widest hover:bg-primary-fixed transition-colors"
            >
              {voiceSaved ? '✓ Guardado' : 'Guardar Voz Local'}
            </button>
            <span className="text-xs text-on-surface-variant">
              {systemVoices.length} vozes disponiveis no sistema
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
