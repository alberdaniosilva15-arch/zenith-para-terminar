const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'apikey', 'authorization', 'api_key'];

function maskSensitive(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? obj.substring(0, 150) : obj;
  }
  const masked = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s))) {
      masked[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      masked[k] = maskSensitive(v);
    } else {
      masked[k] = typeof v === 'string' ? v.substring(0, 150) : v;
    }
  }
  return masked;
}

function auditLog({ action, tool, input, result, user = 'admin', level }) {
  const entry = {
    timestamp: new Date().toISOString(),
    user,
    level,
    tool,
    action,
    input:   maskSensitive(typeof input  === 'object' ? input  : { raw: String(input).substring(0, 100) }),
    result:  maskSensitive(typeof result === 'object' ? result : { raw: String(result).substring(0, 100) }),
    success: !result?.error,
  };

  appendLog('audit', entry);
  if (result?.error) {
    appendLog('errors', { timestamp: entry.timestamp, tool, action, error: result.error });
  }
}

function appendLog(prefix, entry) {
  const file = path.join(LOG_DIR, `${prefix}-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

const INTENT_PATTERNS = {
  critical:  [/apagar/i, /eliminar/i, /deletar/i, /banir/i, /executar script/i, /remover/i, /correr comando/i],
  sensitive: [/editar/i, /modificar/i, /actualizar/i, /alterar/i, /escrever ficheiro/i, /guardar/i],
};

function classifyIntent(command) {
  const cmd = command.toLowerCase();
  if (INTENT_PATTERNS.critical.some(p  => p.test(cmd))) return 'critical';
  if (INTENT_PATTERNS.sensitive.some(p => p.test(cmd))) return 'sensitive';
  return 'safe';
}

module.exports = { classifyIntent, auditLog };
