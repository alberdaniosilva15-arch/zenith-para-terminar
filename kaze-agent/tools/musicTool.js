const { exec } = require('child_process');

async function playMusic(searchOrUrl) {
  let url = searchOrUrl;
  if (!url.startsWith('http')) {
    // Pesquisa no YouTube
    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchOrUrl)}`;
  }
  
  return new Promise((resolve) => {
    // O comando "start" funciona no Windows para abrir o browser padrão
    exec(`start "" "${url}"`, (err) => {
      if (err) resolve({ error: err.message });
      else resolve({ success: true, action: `Música iniciada: ${searchOrUrl}` });
    });
  });
}

module.exports = { playMusic };
