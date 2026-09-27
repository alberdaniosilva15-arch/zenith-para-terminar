// =============================================================================
// ZENITH RIDE v3.0 — Supabase Client
// Instância única para toda a aplicação
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// -----------------------------------------------------------------------------
// Tecto de tempo por pedido (27/09/2026)
//
// PORQUÊ: durante o incidente do Supabase (14/08 → 27/09) o PostgREST devolvia
// `504` (rápido, apanhado pelo `catch`) mas TAMBÉM deixava ligações penduradas
// sem resposta nenhuma — medido: `curl` sem `--max-time` ficava >20 s em "000".
//
// O `supabase-js` NÃO tem timeout por omissão: um `fetch` que nunca responde
// nunca rejeita, logo o `catch` dos sítios que já têm retry nunca dispara, e o
// spinner fica a rodar **para sempre**. O utilizador não vê erro — vê uma app
// que "está sempre a parar", que foi exactamente o sintoma relatado.
//
// Com este tecto, um pedido pendurado transforma-se num `AbortError` normal aos
// 15 s, e o retry com backoff que já existe (ex.: `AuthContext.loadUserData`,
// 4 tentativas) assume o controlo e acaba por mostrar a mensagem ao utilizador.
//
// 15 s é folgado para rede móvel angolana: hoje o PostgREST responde em ~0,42 s.
// O valor existe para apanhar o caso patológico, não o caso lento.
// -----------------------------------------------------------------------------
const TIMEOUT_MS = 15000;

const fetchComTecto: typeof fetch = (input, init) => {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  // Se quem chamou já trouxe o seu próprio signal, respeitamos ambos.
  const sinalExterno = init?.signal;
  if (sinalExterno) {
    if (sinalExterno.aborted) controlador.abort();
    else sinalExterno.addEventListener('abort', () => controlador.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controlador.signal }).finally(() =>
    clearTimeout(relogio),
  );
};

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    '[Zenith Ride] Variáveis de ambiente em falta.\n' +
    'Cria um ficheiro .env com:\n' +
    '  VITE_SUPABASE_URL=https://<projeto>.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=<chave-anon-pública>'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: true,
  },
  db: {
    schema: 'public', // schema explícito — previne erros silenciosos com multi-schema
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    fetch: fetchComTecto,
  },
});

// Helper: obter o URL de uma Edge Function
export const edgeFunctionUrl = (name: string) =>
  `${supabaseUrl}/functions/v1/${name}`;
