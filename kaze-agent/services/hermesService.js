const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const STATUS_TIMEOUT_MS = 3500;
const STARTUP_RETRIES = 12;
const STARTUP_RETRY_DELAY_MS = 1000;
const LOG_BUFFER_LIMIT = 40;

let hermesProcess = null;
let startupPromise = null;
let lastError = null;
let lastLaunchSource = null;
let lastStartedAt = null;
let stdoutBuffer = [];
let stderrBuffer = [];

function getConfig() {
  return {
    host: process.env.HERMES_HOST || '127.0.0.1',
    port: parseInt(process.env.HERMES_PORT || '4000', 10),
  };
}

function bufferPush(target, text) {
  const chunks = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of chunks) {
    target.push(line);
  }

  if (target.length > LOG_BUFFER_LIMIT) {
    target = target.slice(-LOG_BUFFER_LIMIT);
  }

  return target;
}

function findBinaryOnPath(name) {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat']
    : [''];

  for (const dir of pathEntries) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveHermesLaunch() {
  if (process.env.HERMES_COMMAND) {
    return {
      command: process.env.HERMES_COMMAND,
      args: [],
      shell: true,
      source: 'HERMES_COMMAND',
    };
  }

  const bridgeScript = path.join(__dirname, 'hermesBridge.js');
  if (fs.existsSync(bridgeScript)) {
    return {
      command: process.execPath,
      args: [bridgeScript],
      shell: false,
      source: 'bridge',
      cwd: process.cwd(),
    };
  }

  return null;
}

function requestJson(method, route, body, timeoutMs = STATUS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const { host, port } = getConfig();
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: host,
        port,
        path: route,
        method,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw || null;
          }

          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            data: parsed,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Hermes timeout (${timeoutMs}ms)`));
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

async function pingHermes() {
  const routes = ['/status', '/health'];
  for (const route of routes) {
    try {
      const response = await requestJson('GET', route);
      if (response.ok) {
        return { reachable: true, route, response };
      }
    } catch {
      // tenta a próxima rota
    }
  }

  return { reachable: false };
}

function attachProcessListeners(child) {
  child.stdout?.on('data', (chunk) => {
    stdoutBuffer = bufferPush(stdoutBuffer, chunk.toString('utf8'));
  });

  child.stderr?.on('data', (chunk) => {
    stderrBuffer = bufferPush(stderrBuffer, chunk.toString('utf8'));
  });

  child.on('exit', (code, signal) => {
    hermesProcess = null;
    if (code !== 0) {
      lastError = `Hermes terminou com código ${code ?? 'null'} (${signal ?? 'sem sinal'})`;
    }
  });

  child.on('error', (error) => {
    hermesProcess = null;
    lastError = error.message;
  });
}

async function startHermes() {
  const existing = await pingHermes();
  if (existing.reachable) {
    return describeStatus(existing.response.data);
  }

  if (hermesProcess && !hermesProcess.killed) {
    return describeStatus();
  }

  const launch = resolveHermesLaunch();
  if (!launch) {
    lastError = 'Hermes não configurado. Define HERMES_COMMAND, HERMES_ENTRY ou HERMES_DIR.';
    return describeStatus();
  }

  stdoutBuffer = [];
  stderrBuffer = [];
  lastLaunchSource = launch.source;
  lastError = null;

  hermesProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd || process.cwd(),
    env: {
      ...process.env,
      PORT: String(getConfig().port),
      HERMES_PORT: String(getConfig().port),
      HERMES_HOST: getConfig().host,
      HOST: getConfig().host,
    },
    shell: launch.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  lastStartedAt = new Date().toISOString();
  attachProcessListeners(hermesProcess);

  for (let attempt = 0; attempt < STARTUP_RETRIES; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, STARTUP_RETRY_DELAY_MS));
    const probe = await pingHermes();
    if (probe.reachable) {
      return describeStatus(probe.response.data);
    }
  }

  lastError = lastError || 'Hermes não respondeu após o arranque automático.';
  return describeStatus();
}

async function ensureStarted() {
  const probe = await pingHermes();
  if (probe.reachable) {
    return describeStatus(probe.response.data);
  }

  if (!startupPromise) {
    startupPromise = startHermes().finally(() => {
      startupPromise = null;
    });
  }

  return startupPromise;
}

function describeStatus(remoteStatus = null) {
  const { host, port } = getConfig();
  return {
    configured: Boolean(resolveHermesLaunch()),
    running: Boolean(remoteStatus) || Boolean(hermesProcess && !hermesProcess.killed),
    host,
    port,
    launchSource: lastLaunchSource,
    lastStartedAt,
    lastError,
    pid: hermesProcess?.pid ?? null,
    remoteStatus,
    logs: {
      stdout: stdoutBuffer.slice(-10),
      stderr: stderrBuffer.slice(-10),
    },
  };
}

async function getStatus() {
  const probe = await pingHermes();
  if (probe.reachable) {
    return describeStatus(probe.response.data);
  }

  return describeStatus();
}

async function execute(task, options = {}) {
  await ensureStarted();

  const payload = {
    task,
    command: task,
    ...options,
  };

  const routes = [
    ['/execute', payload],
    ['/command', { command: task, ...options }],
  ];

  for (const [route, body] of routes) {
    try {
      const response = await requestJson('POST', route, body, 90_000);
      if (response.ok) {
        return {
          success: true,
          route,
          response: response.data?.response ?? response.data?.result ?? response.data,
          raw: response.data,
        };
      }

      if (response.status !== 404) {
        return {
          success: false,
          route,
          error: response.data?.error || `Hermes ${response.status}`,
          raw: response.data,
        };
      }
    } catch (error) {
      lastError = error.message;
    }
  }

  return {
    success: false,
    error: lastError || 'Hermes indisponível.',
  };
}

async function listSkills() {
  await ensureStarted();

  const routes = ['/skills', '/capabilities'];
  for (const route of routes) {
    try {
      const response = await requestJson('GET', route, null, 8_000);
      if (response.ok) {
        return response.data?.skills || response.data?.capabilities || response.data || [];
      }
    } catch (error) {
      lastError = error.message;
    }
  }

  return [];
}

module.exports = {
  ensureStarted,
  getStatus,
  execute,
  listSkills,
};
