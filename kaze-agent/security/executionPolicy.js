// Execution Policy Engine — camada entre validação e execução
// Bloqueia comportamentos mesmo que passem na validação de schema

const POLICIES = {
  'file.deleteFile': {
    maxPerSession: 3,
    requiresConfirmation: true,
    check: (args, context) => {
      if (context.deletionsThisSession >= 3) {
        return { blocked: true, reason: 'Limite de 3 eliminações por sessão atingido. Reinicia o agente para continuar.' };
      }
      return { allowed: true };
    },
  },
  'file.writeFile': {
    check: (args) => {
      if (!args.content || args.content.length > 50_000) {
        return { blocked: true, reason: 'Conteúdo excede 50KB. Divide em partes menores.' };
      }
      return { allowed: true };
    },
  },
  'file.listDir': {
    check: () => ({ allowed: true }), // sempre permitido
  },
  'file.readFile': {
    check: () => ({ allowed: true }),
  },
  'file.createFolder': {
    check: () => ({ allowed: true }),
  },
  'network.get': {
    check: () => ({ allowed: true }),
  },
  'network.post': {
    check: (args) => {
      const bodyStr = JSON.stringify(args.body || {});
      if (bodyStr.length > 10_000) {
        return { blocked: true, reason: 'Payload POST excede 10KB' };
      }
      return { allowed: true };
    },
  },
  'email.sendEmail': {
    maxPerSession: 5,
    check: (args, context) => {
      if (context.emailsThisSession >= 5) {
        return { blocked: true, reason: 'Limite de 5 emails por sessão atingido.' };
      }
      if (!args.to || !args.subject || !args.body) {
        return { blocked: true, reason: 'Email incompleto.' };
      }
      return { allowed: true };
    },
  },
  'music.playMusic': {
    check: () => ({ allowed: true }),
  },
  'hermes.execute': {
    check: (args) => {
      if (!args.task || String(args.task).trim().length < 3) {
        return { blocked: true, reason: 'Task Hermes demasiado curta.' };
      }
      if (String(args.task).length > 4_000) {
        return { blocked: true, reason: 'Task Hermes demasiado longa.' };
      }
      return { allowed: true };
    },
  },
};

// Contexto de sessão para tracking de limites
const sessionContext = {
  deletionsThisSession: 0,
  writesThisSession: 0,
  emailsThisSession: 0,
  toolCallsThisCommand: 0,
};

function enforcePolicy(call) {
  const policy = POLICIES[call.tool];
  if (!policy) return { blocked: true, reason: `Política não definida para: ${call.tool}` };

  const result = policy.check(call.args, sessionContext);

  // Actualiza contadores após execução permitida
  if (result.allowed) {
    if (call.tool === 'file.deleteFile') sessionContext.deletionsThisSession++;
    if (call.tool === 'file.writeFile')  sessionContext.writesThisSession++;
    if (call.tool === 'email.sendEmail') sessionContext.emailsThisSession++;
  }

  return result;
}

function resetCommandContext() {
  sessionContext.toolCallsThisCommand = 0;
}

function incrementToolCount() {
  sessionContext.toolCallsThisCommand++;
  return sessionContext.toolCallsThisCommand;
}

module.exports = { enforcePolicy, resetCommandContext, incrementToolCount, sessionContext };
