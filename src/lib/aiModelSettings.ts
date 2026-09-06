export const LOCAL_KAZE_URL = 'http://localhost:3847';

export const LS_IA_PROVIDER = 'zenith_ia_provider_v2';
export const LS_IA_MODEL = 'zenith_ia_model_v2';
// A chave passa a vir sempre da variável de ambiente, nunca do localStorage.
// export const LS_IA_API_KEY foi removida — deixa de existir uma key de
// localStorage para a chave de API.
export const LS_IA_BASE_URL = 'zenith_ia_base_url_v2';
export const LS_IA_MODELS_CACHE = 'zenith_ia_models_cache';

export type AiProvider = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'custom';

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiModelSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export const PROVIDERS: Array<{ id: AiProvider; label: string; needsBaseUrl?: boolean }> = [
  { id: 'google', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'groq', label: 'Groq' },
  { id: 'custom', label: 'API compativel', needsBaseUrl: true },
];

export const DEFAULT_MODELS_BY_PROVIDER: Record<AiProvider, AiModelOption[]> = {
  google: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
  openrouter: [
    { id: 'openrouter/free', label: 'OpenRouter Auto (Gratuito)' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (Pago)' },
    { id: 'openai/gpt-4o-mini', label: 'OpenRouter GPT-4o Mini' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)' },
    { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)' },
  ],
  custom: [
    { id: 'gpt-4o-mini', label: 'Modelo padrao' },
  ],
};

export function getStored(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    console.debug('Storage errors ignored');
  }
}

export function normalizeProvider(value: string | null | undefined): AiProvider {
  const provider = String(value || '').toLowerCase();
  return PROVIDERS.some((entry) => entry.id === provider) ? (provider as AiProvider) : 'groq';
}

export function getDefaultModel(provider: AiProvider) {
  return DEFAULT_MODELS_BY_PROVIDER[provider]?.[0]?.id || '';
}

export function getProviderBaseUrl(provider: AiProvider, storedBaseUrl = '') {
  if (storedBaseUrl.trim()) return storedBaseUrl.trim().replace(/\/+$/, '');
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  return '';
}

export function getAiModelSettings(): AiModelSettings {
  const provider = normalizeProvider(getStored(LS_IA_PROVIDER, 'groq'));
  let model = getStored(LS_IA_MODEL, getDefaultModel(provider)) || getDefaultModel(provider);
  
  // Re-map deprecated models to avoid 404
  if (model.includes('gemini-1.5-pro') || model.includes('gemini-2.5-pro')) model = 'gemini-1.5-pro';
  if (model.includes('gemini-1.5-flash') || model.includes('gemini-2.5-flash')) model = 'gemini-2.0-flash';

  // Fallback se o modelo armazenado já não existir na lista do provider
  const availableModels = DEFAULT_MODELS_BY_PROVIDER[provider] || [];
  if (!availableModels.some(m => m.id === model)) {
    model = getDefaultModel(provider);
  }

  const effectiveKey = (
    (provider === 'groq' ? (import.meta.env.VITE_GROQ_API_KEY || (import.meta.env as any).GROQ_API_KEY) : null) ||
    (provider === 'google' ? (import.meta.env.VITE_GEMINI_API_KEY || (import.meta.env as any).GEMINI_API_KEY) : null) ||
    import.meta.env.VITE_GROQ_API_KEY ||
    (import.meta.env as any).GROQ_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    (import.meta.env as any).GEMINI_API_KEY ||
    import.meta.env.VITE_IA_API_KEY ||
    ''
  ).trim();

  return {
    provider,
    model,
    apiKey: effectiveKey,
    baseUrl: getProviderBaseUrl(provider, getStored(LS_IA_BASE_URL)),
  };
}

export function buildKazeApiKeys(settings = getAiModelSettings()) {
  const groqKey = (import.meta.env.VITE_GROQ_API_KEY || (import.meta.env as any).GROQ_API_KEY || '').trim();
  const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY || (import.meta.env as any).GEMINI_API_KEY || '').trim();
  const iaKey = (import.meta.env.VITE_IA_API_KEY || (import.meta.env as any).OPENROUTER_API_KEY || '').trim();

  return {
    [settings.provider]: settings.apiKey,
    gemini: geminiKey || (settings.provider === 'google' ? settings.apiKey : undefined),
    google: geminiKey || (settings.provider === 'google' ? settings.apiKey : undefined),
    groq: groqKey || (settings.provider === 'groq' ? settings.apiKey : undefined),
    openrouter: iaKey || (settings.provider === 'openrouter' ? settings.apiKey : undefined),
    openai: settings.provider === 'openai' ? settings.apiKey : undefined,
    anthropic: settings.provider === 'anthropic' ? settings.apiKey : undefined,
    custom: settings.provider === 'custom' ? settings.apiKey : undefined,
  };
}
