const fs   = require('fs');
const path = require('path');
const { isSafeToMemorize, isSafeToCreateSkill } = require('../security/memoryFirewall');

const BRAIN_DIR    = path.join(__dirname);
const SKILLS_DIR   = path.join(__dirname, '../skills/auto');
const SESSIONS_DIR = path.join(BRAIN_DIR, 'sessions');

[BRAIN_DIR, SKILLS_DIR, SESSIONS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

let sessionMemory = {
  sessionId:    `session_${new Date().toISOString().replace(/[:.]/g, '-')}`,
  startedAt:    new Date().toISOString(),
  interactions: [],
  tasksCompleted: [],
  errorsEncountered: [],
  skillsUsed:   [],
};

// Memória de longo prazo

function loadLongTermMemory() {
  const file = path.join(BRAIN_DIR, 'MEMORY.md');
  if (!fs.existsSync(file)) return { preferences: {}, patterns: {}, skills: [] };
  const raw   = fs.readFileSync(file, 'utf8');
  const match = raw.match(/```json\n([\s\S]+?)\n```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch { /* ignora */ }
  }
  return { preferences: {}, patterns: {}, skills: [] };
}

function saveLongTermMemory(data) {
  const file    = path.join(BRAIN_DIR, 'MEMORY.md');
  const content = `# Memória do KAZE\n\nÚltima actualização: ${new Date().toISOString()}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(file, content, 'utf8');
}

// Registo de interacção com Memory Firewall

function recordInteraction({ role, content, toolsUsed = [], result = null }) {
  const entry = {
    role,
    content: typeof content === 'string' ? content.substring(0, 500) : JSON.stringify(content).substring(0, 500),
    timestamp:  new Date().toISOString(),
    toolsUsed,
    result: result ? String(result).substring(0, 150) : null,
  };

  // Firewall — não guarda entradas suspeitas
  if (!isSafeToMemorize(entry)) return;

  sessionMemory.interactions.push(entry);
  if (sessionMemory.interactions.length % 10 === 0) persistSession();
}

function persistSession() {
  const file = path.join(SESSIONS_DIR, `${sessionMemory.sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(sessionMemory, null, 2), 'utf8');
}

// Full-text search em sessões passadas (padrão Hermes)

function searchPastSessions(query) {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const files      = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const queryLower = query.toLowerCase();
  const results    = [];

  for (const file of files.slice(-20)) {
    try {
      const session  = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
      const relevant = session.interactions.filter(i =>
        i.content && i.content.toLowerCase().includes(queryLower)
      );
      if (relevant.length > 0) {
        results.push({ sessionId: session.sessionId, date: session.startedAt, matches: relevant.slice(0, 2) });
      }
    } catch { /* ignora ficheiros corrompidos */ }
  }
  return results.slice(0, 5);
}

// Skill Trust Score (padrão Hermes melhorado)
// confidence = (success_rate * log(uses+1)) * recency_factor

function computeTrustScore(skill) {
  const uses        = skill.uses || 1;
  const successRate = skill.successRate || 100;
  const daysSince   = skill.lastUsed
    ? (Date.now() - new Date(skill.lastUsed).getTime()) / 86_400_000
    : 0;
  const recency     = Math.max(0.3, 1 - daysSince / 30); // decai em 30 dias
  return (successRate / 100) * Math.log(uses + 1) * recency;
}

// Criação automática de skill com firewall

async function maybeCreateSkill({ taskDescription, steps, toolsUsed, errors = [] }) {
  if (!isSafeToCreateSkill(taskDescription, steps, errors)) return;

  const skillName = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 40);

  const skillFile = path.join(SKILLS_DIR, `${skillName}.md`);

  if (fs.existsSync(skillFile)) {
    improveSkill(skillFile, errors);
    return;
  }

  const content = `# Skill: ${taskDescription}

Criada: ${new Date().toISOString()}
Vezes usada: 1
Taxa de sucesso: 100%
Última utilização: ${new Date().toISOString()}
Trust Score: ${computeTrustScore({ uses: 1, successRate: 100 }).toFixed(2)}

## Passos
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Ferramentas
${toolsUsed.map(t => `- ${t}`).join('\n')}
`;

  fs.writeFileSync(skillFile, content, 'utf8');
  updateSkillsIndex(skillName, taskDescription);
}

function improveSkill(skillFile, errors = []) {
  let content = fs.readFileSync(skillFile, 'utf8');
  const usesMatch = content.match(/Vezes usada: (\d+)/);
  const successMatch = content.match(/Taxa de sucesso: (\d+)%/);
  const uses    = parseInt(usesMatch?.[1] || 1) + 1;
  const prevSuccess = parseInt(successMatch?.[1] || 100);
  const thisSuccess = errors.length === 0 ? 100 : 0;
  const newSuccess  = Math.round((prevSuccess * (uses - 1) + thisSuccess) / uses);
  const trust       = computeTrustScore({ uses, successRate: newSuccess, lastUsed: new Date().toISOString() });

  content = content
    .replace(/Vezes usada: \d+/, `Vezes usada: ${uses}`)
    .replace(/Taxa de sucesso: \d+%/, `Taxa de sucesso: ${newSuccess}%`)
    .replace(/Última utilização: .+/, `Última utilização: ${new Date().toISOString()}`)
    .replace(/Trust Score: .+/, `Trust Score: ${trust.toFixed(2)}`);

  fs.writeFileSync(skillFile, content, 'utf8');
}

function updateSkillsIndex(skillName, description) {
  const indexFile = path.join(path.dirname(SKILLS_DIR), 'README.md');
  const line      = `- [${skillName}](./auto/${skillName}.md) — ${description}\n`;
  if (!fs.existsSync(indexFile)) {
    fs.writeFileSync(indexFile, `# Skills do KAZE\n\n${line}`);
  } else {
    fs.appendFileSync(indexFile, line);
  }
}

function learnPreference(key, value) {
  const memory  = loadLongTermMemory();
  memory.preferences[key] = value;
  memory.lastUpdated       = new Date().toISOString();
  saveLongTermMemory(memory);
}

function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content      = fs.readFileSync(path.join(SKILLS_DIR, f), 'utf8');
      const nameMatch    = content.match(/# Skill: (.+)/);
      const usesMatch    = content.match(/Vezes usada: (\d+)/);
      const successMatch = content.match(/Taxa de sucesso: (\d+)%/);
      const trustMatch   = content.match(/Trust Score: ([\d.]+)/);
      const lastMatch    = content.match(/Última utilização: (.+)/);
      return {
        file:        f,
        name:        nameMatch?.[1] || f,
        uses:        parseInt(usesMatch?.[1] || 0),
        successRate: parseInt(successMatch?.[1] || 100),
        trustScore:  parseFloat(trustMatch?.[1] || 0),
        lastUsed:    lastMatch?.[1]?.trim(),
      };
    })
    .sort((a, b) => b.trustScore - a.trustScore); // ordena por confiança
}

function findRelevantSkill(query) {
  const skills     = listSkills();
  const queryWords = query.toLowerCase().split(/\s+/);
  for (const skill of skills) {
    if (skill.trustScore < 0.3) continue; // ignora skills pouco confiáveis
    const skillWords = skill.name.toLowerCase().split(/[\s_]+/);
    const overlap    = queryWords.filter(w => skillWords.some(s => s.includes(w) || w.includes(s)));
    if (overlap.length >= 2) return skill;
  }
  return null;
}

// Memory pruning

function consolidateMemories() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length <= 20) return;

  console.log('[MEMORY] Consolidando sessões antigas...');
  const toConsolidate = files.slice(0, files.length - 20);
  const memory = loadLongTermMemory();

  toConsolidate.forEach(f => {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      // Extrai padrões e preferências automaticamente
      session.interactions.forEach(i => {
        if (i.role === 'user' && i.content.length > 10) {
          if (i.content.includes('prefiro') || i.content.includes('gosto')) {
             const key = i.content.substring(0, 20).trim();
             memory.preferences[key] = { value: i.content, date: session.startedAt };
          }
        }
      });
      fs.unlinkSync(path.join(SESSIONS_DIR, f));
    } catch (e) { console.error('[CONSOLIDATE_ERR]', e); }
  });

  // Decay: remover preferências com mais de 90 dias
  const now = Date.now();
  Object.keys(memory.preferences).forEach(k => {
    const date = memory.preferences[k].date ? new Date(memory.preferences[k].date).getTime() : 0;
    if (now - date > 90 * 86_400_000) delete memory.preferences[k];
  });

  saveLongTermMemory(memory);
}

function pruneOldSessions() {
  consolidateMemories();
}

function pruneWeakSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return;
  fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).forEach(f => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, f), 'utf8');
    const uses    = parseInt(content.match(/Vezes usada: (\d+)/)?.[1] || 0);
    const success = parseInt(content.match(/Taxa de sucesso: (\d+)%/)?.[1] || 100);
    if (uses > 5 && success < 30) {
      fs.unlinkSync(path.join(SKILLS_DIR, f));
    }
  });
}

function closeSession() {
  sessionMemory.endedAt = new Date().toISOString();
  persistSession();
  pruneOldSessions();
  pruneWeakSkills();
}

module.exports = {
  recordInteraction, persistSession, closeSession,
  searchPastSessions, maybeCreateSkill, learnPreference,
  loadLongTermMemory, saveLongTermMemory, listSkills,
  findRelevantSkill, getSession: () => sessionMemory,
};