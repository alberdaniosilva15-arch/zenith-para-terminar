const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { processCommand } = require('./agent');
const memory = require('./brain/kazeMemory');

const hermesService = {
  getStatus: async () => ({ status: 'online', mode: 'proxy' }),
  ensureStarted: async () => ({ status: 'online' }),
  listSkills: async () => [],
  execute: async () => ({ success: false, error: 'Hermes moved to gemini-proxy' })
};


const PORT = parseInt(process.env.KAZE_PORT || '3847', 10);
const BIND_ADDRESS = '127.0.0.1';
const TOKEN_FILE = path.join(__dirname, '.kaze-token');
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://[::1]:4000',
]);
const MAX_COMMANDS_PER_MINUTE = 100;
const BODY_LIMIT = 50_000;
const AUDIO_BODY_LIMIT = 8_000_000;
const authCache = new Map();
const rateLimitMap = new Map();

let LOCAL_TOKEN;
if (fs.existsSync(TOKEN_FILE)) {
  LOCAL_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
} else {
  LOCAL_TOKEN = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, LOCAL_TOKEN);
  console.log(`[KAZE] Token gerado e guardado em: ${TOKEN_FILE}`);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode);
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

function isLoopbackRequest(req) {
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
}

function normalizeIp(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isRateLimited(ip) {
  const now = Date.now();
  const currentWindow = rateLimitMap.get(ip) || [];
  const validEntries = currentWindow.filter((timestamp) => now - timestamp < 60_000);

  if (validEntries.length >= MAX_COMMANDS_PER_MINUTE) {
    rateLimitMap.set(ip, validEntries);
    return true;
  }

  validEntries.push(now);
  rateLimitMap.set(ip, validEntries);
  return false;
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice('Bearer '.length).trim();
}

async function verifySupabaseToken(token) {
  if (!token) return false;

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.valid;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return false;
  }

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!userRes.ok) {
      authCache.set(token, { valid: false, expiresAt: Date.now() + 10_000 });
      return false;
    }

    const userData = await userRes.json();
    if (!userData?.id) {
      authCache.set(token, { valid: false, expiresAt: Date.now() + 10_000 });
      return false;
    }

    // Role check: apenas administradores podem controlar o agente local
    const roleRes = await fetch(`${supabaseUrl}/rest/v1/users?select=role&id=eq.${userData.id}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
    const rows = await roleRes.json();
    const valid = roleRes.ok && Array.isArray(rows) && rows[0]?.role === 'admin';

    authCache.set(token, {
      valid,
      expiresAt: Date.now() + (valid ? 60_000 : 10_000),
    });
    return valid;
  } catch {
    return false;
  }
}

async function authenticate(req) {
  const token = extractBearerToken(req);
  if (!token) return false;
  if (token === LOCAL_TOKEN) return true;
  return verifySupabaseToken(token);
}

function readJsonBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        req.destroy();
        reject(new Error('Payload demasiado grande'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('JSON inválido'));
      }
    });

    req.on('error', reject);
  });
}

function cleanTranscript(text) {
  return String(text || '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGeminiModelName(model) {
  const value = String(model || '').trim();
  if (!value) return 'models/gemini-2.5-flash';
  return value.startsWith('models/') ? value : `models/${value}`;
}

async function transcribeAudioPayload(payload) {
  const apiKey = String(payload.apiKey || '').trim()
    || process.env.GEMINI_API_KEY
    || process.env.VITE_GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY indisponivel para transcricao local.');
  }

  const audioBase64 = String(payload.audioBase64 || '');
  const mimeType = String(payload.mimeType || 'audio/wav').split(';')[0];
  if (!audioBase64 || audioBase64.length < 1000) {
    throw new Error('Audio invalido ou vazio.');
  }

  const model = normalizeGeminiModelName(payload.model || process.env.KAZE_STT_MODEL || 'gemini-2.5-flash');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcreve o audio em portugues. Responde apenas com a frase dita, sem comentarios, sem pontuacao extra e sem markdown.',
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: audioBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 120,
        },
      }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini STT ${response.status}`);
  }

  const text = cleanTranscript(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
  if (!text) {
    throw new Error('Transcricao vazia.');
  }

  return { text, model: model.replace(/^models\//, ''), mimeType };
}

async function handleCommandRequest(req, res, mode = 'smart') {
  const ip = normalizeIp(req);
  if (isRateLimited(ip)) {
    sendJson(res, 429, { error: 'Rate limit excedido. Aguarde um minuto.' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    if (typeof payload.command !== 'string' || payload.command.length > 2000) {
      sendJson(res, 400, { error: 'Comando inválido' });
      return;
    }

    const result = await processCommand({
      command: payload.command,
      confirmed: Boolean(payload.confirmed),
      apiKeys: payload.apiKeys || {},
      maxIterations: payload.maxIterations,
      mode,
    });

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
      sendJson(res, 403, { error: 'Origem não permitida' });
      return;
    }
    res.writeHead(200);
    res.end();
    return;
  }

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: 'Acesso negado' });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const hermes = await hermesService.getStatus();
    sendJson(res, 200, {
      status: 'online',
      session: memory.getSession().sessionId,
      hermes,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/hermes/status') {
    const hermes = await hermesService.ensureStarted();
    sendJson(res, 200, hermes);
    return;
  }

  const authenticated = await authenticate(req);
  if (!authenticated) {
    sendJson(res, 401, { error: 'Token inválido' });
    return;
  }

  if (req.method === 'POST' && req.url === '/transcribe-audio') {
    const ip = normalizeIp(req);
    if (isRateLimited(ip)) {
      sendJson(res, 429, { error: 'Rate limit excedido. Aguarde um minuto.' });
      return;
    }

    try {
      const payload = await readJsonBody(req, AUDIO_BODY_LIMIT);
      const result = await transcribeAudioPayload(payload);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/skills') {
    const [hermesSkills, localSkills] = await Promise.all([
      hermesService.listSkills().catch(() => []),
      Promise.resolve(memory.listSkills()),
    ]);

    sendJson(res, 200, {
      local: localSkills,
      hermes: hermesSkills,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/command') {
    await handleCommandRequest(req, res, 'smart');
    return;
  }

  if (req.method === 'POST' && req.url === '/auto-operate') {
    await handleCommandRequest(req, res, 'auto');
    return;
  }

  if (req.method === 'POST' && req.url === '/hermes/execute') {
    const ip = normalizeIp(req);
    if (isRateLimited(ip)) {
      sendJson(res, 429, { error: 'Rate limit excedido. Aguarde um minuto.' });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const task = payload.task || payload.command;
      if (typeof task !== 'string' || task.length > 4000) {
        sendJson(res, 400, { error: 'Task Hermes inválida' });
        return;
      }

      const result = await hermesService.execute(task, {
        skill: payload.skill,
        dryRun: Boolean(payload.dryRun),
        context: payload.context || {},
      });

      sendJson(res, result.success ? 200 : 502, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`[KAZE Local Agent] Activo em ${BIND_ADDRESS}:${PORT}`);
  hermesService.ensureStarted().catch((error) => {
    console.warn('[KAZE] Hermes auto-start falhou:', error.message);
  });
});

process.on('SIGINT', () => {
  memory.closeSession();
  console.log('\n[KAZE] Sessão guardada. Até logo.');
  process.exit(0);
});
