export const ENV = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
};

if (!ENV.SUPABASE_URL) {
  throw new Error('[ENV] Missing VITE_SUPABASE_URL');
}
