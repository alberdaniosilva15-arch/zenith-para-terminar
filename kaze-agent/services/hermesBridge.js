const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HOST = process.env.HERMES_HOST || '127.0.0.1';
const PORT = parseInt(process.env.HERMES_PORT || '4000', 10);
const MODEL = process.env.HERMES_MODEL || 'gemini-2.5-flash';
const MAX_BODY_SIZE = 100_000;

let lastError = null;
let lastSessionId = null;
let lastRunAt = null;
let activeExecution = Promise.resolve();

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
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

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function discoverHermesRepo() {
  return firstExisting([
    process.env.HERMES_REPO,
    process.env.HERMES_DIR,
    path.join(os.homedir(), 'Videos', 'hermes-agent-main', 'hermes-agent-main'),
    path.join(os.homedir(), 'Videos', 'projecto hermes', 'hermes-agent-main', 'hermes-agent-main'),
  ]);
}

function discoverHermesPython(repoPath) {
  return firstExisting([
    process.env.HERMES_PYTHON,
    repoPath && path.join(repoPath, 'venv', 'Scripts', 'python.exe'),
  ]);
}

function buildHermesEnv(repoPath) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const hermesHome = process.env.HERMES_HOME || path.join(process.cwd(), 'kaze-agent', '.hermes-kaze');

  fs.mkdirSync(hermesHome, { recursive: true });

  return {
    ...process.env,
    GEMINI_API_KEY: geminiKey,
    GOOGLE_API_KEY: geminiKey,
    HERMES_HOME: hermesHome,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    HERMES_QUIET: '1',
    HERMES_REPO: repoPath,
  };
}

function scanSkillsDirectory(rootDir, sourceLabel) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return [];
  }

  const skills = [];
  for (const category of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryPath = path.join(rootDir, category.name);

    for (const skill of fs.readdirSync(categoryPath, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const skillDir = path.join(categoryPath, skill.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      skills.push({
        name: skill.name,
        category: category.name,
        source: sourceLabel,
        path: skillDir,
      });
    }
  }

  return skills;
}

function listSkills() {
  const repoPath = discoverHermesRepo();
  if (!repoPath) return [];

  return [
    ...scanSkillsDirectory(path.join(repoPath, 'skills'), 'builtin'),
    ...scanSkillsDirectory(path.join(repoPath, 'optional-skills'), 'optional'),
  ];
}

function buildPrompt(task, dryRun = false, context = {}) {
  const parts = [];

  if (dryRun) {
    parts.push('Dry run obrigatório: analisa, planeia e explica o que farias, sem executar acções irreversíveis nem alterar ficheiros.');
  } else {
    parts.push('Executa a tarefa com segurança e resume claramente o resultado final.');
  }

  parts.push(`Tarefa: ${task}`);

  if (context && Object.keys(context).length > 0) {
    parts.push(`Contexto JSON: ${JSON.stringify(context)}`);
  }

  return parts.join('\n\n');
}

function parseHermesOutput(stdout) {
  const normalized = String(stdout || '').trim();
  const sessionMatch = normalized.match(/session_id:\s*([^\r\n]+)/i);
  const sessionId = sessionMatch ? sessionMatch[1].trim() : null;
  const response = normalized.replace(/\n?\s*session_id:\s*[^\r\n]+\s*$/i, '').trim();

  return {
    response,
    sessionId,
    raw: normalized,
  };
}

function executeHermesTask({ task, skill, dryRun = false, context = {} }) {
  const repoPath = discoverHermesRepo();
  const pythonPath = discoverHermesPython(repoPath);
  const runnerPath = path.join(__dirname, 'hermesRunner.py');

  if (!repoPath) {
    throw new Error('Hermes repo não encontrado. Define HERMES_REPO ou HERMES_DIR.');
  }

  if (!pythonPath) {
    throw new Error('Python do Hermes não encontrado. Define HERMES_PYTHON.');
  }

  if (!fs.existsSync(runnerPath)) {
    throw new Error('Wrapper do Hermes não encontrado.');
  }

  const prompt = buildPrompt(task, dryRun, context);
  const args = [
    runnerPath,
    repoPath,
    '--',
    'chat',
    '-Q',
    '--provider',
    'gemini',
    '--model',
    MODEL,
    '--source',
    'tool',
    '--max-turns',
    '10',
  ];

  if (skill) {
    args.push('-s', skill);
  }

  args.push('-q', prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, args, {
      cwd: repoPath,
      env: buildHermesEnv(repoPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      const parsed = parseHermesOutput(stdout);
      lastRunAt = new Date().toISOString();
      lastSessionId = parsed.sessionId || lastSessionId;

      if (code === 0) {
        lastError = null;
        resolve({
          ok: true,
          response: parsed.response,
          sessionId: parsed.sessionId,
          stdout: parsed.raw,
          stderr: stderr.trim(),
        });
        return;
      }

      lastError = stderr.trim() || parsed.response || `Hermes terminou com código ${code}`;
      reject(new Error(lastError));
    });
  });
}

function queueExecution(payload) {
  const run = activeExecution
    .catch(() => null)
    .then(() => executeHermesTask(payload));

  activeExecution = run.finally(() => null);
  return run;
}

function getStatus() {
  const repoPath = discoverHermesRepo();
  const pythonPath = discoverHermesPython(repoPath);
  const skills = listSkills();
  const geminiAvailable = Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  return {
    configured: Boolean(repoPath && pythonPath),
    running: true,
    host: HOST,
    port: PORT,
    repoPath,
    pythonPath,
    model: MODEL,
    geminiAvailable,
    skillsCount: skills.length,
    lastRunAt,
    lastSessionId,
    lastError,
  };
}

const server = http.createServer(async (req, res) => {
  if (!isLoopback(req)) {
    sendJson(res, 403, { error: 'Acesso negado' });
    return;
  }

  if (req.method === 'GET' && (req.url === '/status' || req.url === '/health')) {
    sendJson(res, 200, getStatus());
    return;
  }

  if (req.method === 'GET' && req.url === '/skills') {
    sendJson(res, 200, { skills: listSkills() });
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    try {
      const payload = await readJsonBody(req);
      if (!payload.task || typeof payload.task !== 'string') {
        sendJson(res, 400, { error: 'Task inválida' });
        return;
      }

      const result = await queueExecution({
        task: payload.task,
        skill: typeof payload.skill === 'string' ? payload.skill : '',
        dryRun: Boolean(payload.dryRun),
        context: payload.context && typeof payload.context === 'object' ? payload.context : {},
      });

      sendJson(res, 200, result);
    } catch (error) {
      lastError = error.message;
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[Hermes Bridge] Activo em http://${HOST}:${PORT}`);
});
