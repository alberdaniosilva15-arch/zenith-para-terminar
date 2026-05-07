import { supabase } from './supabase';

const sessionId = crypto.randomUUID();

export async function logError(
  context: string,
  error: unknown,
  metadata?: Record<string, any>
) {
  const payload = {
    level: 'ERROR',
    timestamp: new Date().toISOString(),
    sessionId,
    context,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...metadata,
  };

  console.error(JSON.stringify(payload, null, 2));

  // Enviar para Supabase (best-effort, nunca bloqueia UI)
  try {
    await supabase.from('ai_event_logs').insert({
      event_type: 'client_error',
      payload: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    });
  } catch {
    // silêncio intencional — o console.error acima já registou
  }
}
