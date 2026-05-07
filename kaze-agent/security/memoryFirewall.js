// Memory Firewall — filtra o que o Kaze pode aprender
// Impede memory poisoning via inputs maliciosos

const POISONING_PATTERNS = [
  /delete all/i,
  /rm -rf/i,
  /drop table/i,
  /ignore previous/i,
  /ignore all rules/i,
  /act as/i,
  /jailbreak/i,
  /bypass/i,
  /execute.*system/i,
  /eval\s*\(/i,
];

function isSafeToMemorize(entry) {
  const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);

  // Bloqueia padrões de envenenamento
  if (POISONING_PATTERNS.some(p => p.test(content))) {
    console.warn('[KAZE MemFirewall] Entrada bloqueada por padrão suspeito:', content.substring(0, 80));
    return false;
  }

  // Não guarda se usou demasiadas tools (comportamento anómalo)
  if (entry.toolsUsed && entry.toolsUsed.length >= 10) {
    console.warn('[KAZE MemFirewall] Bloqueado: demasiadas tool calls numa entrada.');
    return false;
  }

  // Não guarda entradas com resultado de erro puro
  if (entry.result === 'error') return false;

  return true;
}

function isSafeToCreateSkill(taskDescription, steps, errors) {
  // Só cria skill se não houve erros
  if (errors && errors.length > 0) return false;

  // Não cria skill a partir de tarefas que parecem injecção
  if (POISONING_PATTERNS.some(p => p.test(taskDescription))) return false;

  // Mínimo de 3 passos reais
  if (!steps || steps.length < 3) return false;

  return true;
}

module.exports = { isSafeToMemorize, isSafeToCreateSkill };