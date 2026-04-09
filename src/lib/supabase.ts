// =============================================================================
// ZENITH RIDE v3.0 — Supabase Client
// Instância única para toda a aplicação
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    '[MotoGo] Variáveis de ambiente em falta.\n' +
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
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Helper: obter o URL de uma Edge Function
export const edgeFunctionUrl = (name: string) =>
  `${supabaseUrl}/functions/v1/${name}`;
