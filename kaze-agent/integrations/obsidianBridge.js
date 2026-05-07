// Obsidian Local REST API plugin (instalar no Obsidian → Community Plugins)
// Gera uma API Key no plugin após instalar — obrigatório para autenticação.

const OBSIDIAN_HOST = 'http://127.0.0.1';
const OBSIDIAN_PORT = process.env.OBSIDIAN_PORT || 27123;
const OBSIDIAN_KEY  = process.env.OBSIDIAN_API_KEY || ''; // gerada no plugin

const base = `${OBSIDIAN_HOST}:${OBSIDIAN_PORT}`;

function obsidianHeaders() {
  if (!OBSIDIAN_KEY) return {};
  return { Authorization: `Bearer ${OBSIDIAN_KEY}` };
}

const obsidianBridge = {
  ping: async () => {
    if (!OBSIDIAN_KEY) return false; // sem key → desactivado
    try {
      const res = await fetch(`${base}/`, { headers: obsidianHeaders() });
      return res.ok;
    } catch { return false; }
  },

  readNote: async (notePath) => {
    try {
      const res = await fetch(`${base}/vault/${encodeURIComponent(notePath)}`, { headers: obsidianHeaders() });
      if (!res.ok) return { error: `Nota não encontrada: ${notePath}` };
      return { content: await res.text() };
    } catch (e) { return { error: e.message }; }
  },

  writeNote: async (notePath, content) => {
    try {
      const res = await fetch(`${base}/vault/${encodeURIComponent(notePath)}`, {
        method: 'PUT',
        headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
        body: content,
      });
      return { success: res.ok, status: res.status };
    } catch (e) { return { error: e.message }; }
  },

  syncMemory: async (content) => obsidianBridge.writeNote('KAZE/MEMORY.md', content),

  search: async (query) => {
    try {
      const res = await fetch(`${base}/search/simple/?query=${encodeURIComponent(query)}`, { headers: obsidianHeaders() });
      if (!res.ok) return { results: [] };
      return { results: await res.json() };
    } catch (e) { return { results: [], error: e.message }; }
  },
};

module.exports = obsidianBridge;