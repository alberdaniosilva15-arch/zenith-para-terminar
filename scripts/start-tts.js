import { spawn, execSync } from 'child_process';
import http from 'http';

const checkPort = (port) => {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
};

const startTts = async () => {
  console.log('Verificando servidor TTS local (porta 3848)...');
  const isRunning = await checkPort(3848);

  if (isRunning) {
    console.log('✅ Servidor TTS já está a correr!');
    return;
  }

  console.log('⚠️ Servidor TTS não detetado. Tentando iniciar em background...');
  
  try {
    // Verifica/Instala edge-tts se necessario
    try {
      execSync('python -c "import edge_tts"', { stdio: 'ignore' });
    } catch {
      console.log('Instalando dependências Python (edge-tts, aiohttp)...');
      execSync('pip install edge-tts aiohttp', { stdio: 'inherit' });
    }

    const child = spawn('python', ['kaze_voice_server.py'], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref();
    console.log(`✅ Servidor TTS iniciado em background (PID: ${child.pid})`);
  } catch (error) {
    console.log('❌ Não foi possível iniciar o servidor TTS em background. Erro ignorado, fallback local assumirá.');
  }
};

startTts();
