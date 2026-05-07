// APENAS usado pelo Local Agent para webhooks/callbacks internos.
// Chamadas a APIs externas → Edge Function.

const path = require('path');
const fs = require('fs');

const rootEnvPath = path.join(__dirname, '../../.env');
const envMap = {};
if (fs.existsSync(rootEnvPath)) {
  const raw = fs.readFileSync(rootEnvPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (!key || rest.length === 0) return;
    envMap[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  });
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const ALLOWED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '::1',
  hostnameFromUrl(process.env.VITE_SUPABASE_URL || envMap.VITE_SUPABASE_URL || ''),
  hostnameFromUrl(process.env.SUPABASE_URL || envMap.SUPABASE_URL || ''),
].filter(Boolean);

function isDomainAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

const networkTool = {
  get: async (url, headers = {}) => {
    if (!isDomainAllowed(url)) return { error: `Domínio não permitido no Local Agent: ${new URL(url).hostname}` };
    const res = await fetch(url, { headers });
    return { status: res.status, data: await res.json().catch(() => res.text()) };
  },

  post: async (url, body, headers = {}) => {
    if (!isDomainAllowed(url)) return { error: `Domínio não permitido no Local Agent: ${new URL(url).hostname}` };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => res.text()) };
  },
};

module.exports = networkTool;
