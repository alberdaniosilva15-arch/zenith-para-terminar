const { spawn } = require('child_process');

function sanitizeTargetUrl(searchOrUrl) {
  if (typeof searchOrUrl !== 'string') return null;
  const input = searchOrUrl.trim();
  if (!input) return null;

  try {
    const parsed = new URL(input);
    if (parsed.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'open.spotify.com', 'soundcloud.com'].includes(parsed.hostname.toLowerCase())) {
      return parsed.toString();
    }
  } catch {
    // Não é URL válido — tratar como query de pesquisa
  }

  return `https://www.youtube.com/results?search_query=${encodeURIComponent(input)}`;
}

async function playMusic(searchOrUrl) {
  const targetUrl = sanitizeTargetUrl(searchOrUrl);
  if (!targetUrl) {
    return { error: 'URL ou termo de pesquisa inválido.' };
  }

  return new Promise((resolve) => {
    const child = spawn('cmd', ['/c', 'start', '""', targetUrl], { windowsHide: true });
    child.on('error', (err) => resolve({ error: err.message }));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ success: true, action: `Música iniciada: ${searchOrUrl}` });
      } else {
        resolve({ error: `Processo terminou com código ${code}` });
      }
    });
  });
}

module.exports = { playMusic };
