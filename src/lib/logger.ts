const isDev = import.meta.env.DEV;

export const logger = {
  warn: (...args: unknown[]) => { if (isDev) console.warn(...args); },
  info: (...args: unknown[]) => { if (isDev) console.info(...args); },
  error: (...args: unknown[]) => { console.error(...args); }, // erros ficam sempre visíveis
};

export function logError(context: string, error: unknown, extra?: Record<string, unknown>) {
  console.error(`[${context}]`, error, extra ?? '');
}
