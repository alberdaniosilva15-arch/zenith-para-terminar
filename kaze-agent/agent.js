const fs = require('fs');
const path = require('path');
const memory = require('./brain/kazeMemory');
const fileTool = require('./tools/fileTool');
const networkTool = require('./tools/networkTool');
const emailTool = require('./tools/emailTool');
const musicTool = require('./tools/musicTool');
const hermesService = require('./services/hermesService');
const { classifyIntent, auditLog } = require('./security/permissions');
const { enforcePolicy, resetCommandContext, incrementToolCount } = require('./security/executionPolicy');
const { runAutoOperator } = require('./core/autoOperator');

// Windows + Node on this machine fail CA validation for Gemini/OpenRouter.
// This local agent is loopback-only, so we allow insecure TLS to keep the
// admin orchestrator operational on the user's desktop.
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const MAX_TOOLS_PER_COMMAND = 5;
const GEMINI_MODEL_CHAIN = (
  process.env.KAZE_MODEL_CHAIN ||
  'models/gemini-2.5-flash,models/gemini-2.0-flash,models/gemini-1.5-flash'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const TOOLS = {
  file: fileTool,
  network: networkTool,
  email: emailTool,
  music: musicTool,
  hermes: {
    execute: (task, skill, dryRun = false, context = {}) =>
      hermesService.execute(task, { skill, dryRun, context }),
    listSkills: () => hermesService.listSkills(),
  },
};

const TOOL_SCHEMAS = {
  'file.listDir': { required: ['dirPath'], types: { dirPath: 'string' } },
  'file.readFile': { required: ['filePath'], types: { filePath: 'string' } },
  'file.createFolder': { required: ['dirPath'], types: { dirPath: 'string' } },
  'file.writeFile': { required: ['filePath', 'content'], types: { filePath: 'string', content: 'string' } },
  'file.deleteFile': { required: ['filePath'], types: { filePath: 'string' } },
  'network.get': { required: ['url'], types: { url: 'string', headers: 'object' } },
  'network.post': { required: ['url', 'body'], types: { url: 'string', body: 'object', headers: 'object' } },
  'email.sendEmail': { required: ['to', 'subject', 'body'], types: { to: 'string', subject: 'string', body: 'string' } },
  'music.playMusic': { required: ['searchOrUrl'], types: { searchOrUrl: 'string' } },
  'hermes.execute': {
    required: ['task'],
    types: { task: 'string', skill: 'string', dryRun: 'boolean', context: 'object' },
  },
};

const TOOL_ARGUMENT_BUILDERS = {
  'file.listDir': (args) => [args.dirPath],
  'file.readFile': (args) => [args.filePath],
  'file.createFolder': (args) => [args.dirPath],
  'file.writeFile': (args, confirmed) => [args.filePath, args.content, confirmed],
  'file.deleteFile': (args, confirmed) => [args.filePath, confirmed],
  'network.get': (args) => [args.url, args.headers || {}],
  'network.post': (args) => [args.url, args.body, args.headers || {}],
  'email.sendEmail': (args) => [args.to, args.subject, args.body],
  'music.playMusic': (args) => [args.searchOrUrl],
  'hermes.execute': (args) => [args.task, args.skill, args.dryRun, args.context || {}],
};

function validateToolCall(call) {
  if (!call || typeof call.tool !== 'string' || typeof call.args !== 'object' || !call.args) {
    return { valid: false, reason: 'Estrutura de tool call inválida' };
  }

  const schema = TOOL_SCHEMAS[call.tool];
  if (!schema) {
    return { valid: false, reason: `Tool não reconhecida: ${call.tool}` };
  }

  for (const field of schema.required) {
    if (!(field in call.args)) {
      return { valid: false, reason: `Campo em falta: ${field}` };
    }
  }

  for (const [field, expectedType] of Object.entries(schema.types)) {
    if (!(field in call.args)) continue;
    if (typeof call.args[field] !== expectedType) {
      return { valid: false, reason: `Tipo inválido para ${field}` };
    }
  }

  const unknownArgs = Object.keys(call.args).filter((field) => !(field in schema.types));
  if (unknownArgs.length > 0) {
    return { valid: false, reason: `Argumentos não permitidos: ${unknownArgs.join(', ')}` };
  }

  return { valid: true };
}

function buildPlan(command, { intentLevel, existingSkill, routeMeta }) {
  const steps = [];

  if (routeMeta?.route === 'hermes') {
    steps.push(`Encaminhar para Hermes (${routeMeta.reason || 'skill externa'})`);
  } else if (routeMeta?.route === 'auto') {
    steps.push('Entrar em loop multi-step com observação contínua');
  } else if (routeMeta?.route === 'hybrid') {
    steps.push('Combinar tools locais com skills externas do Hermes');
  } else {
    steps.push('Processar no Kaze local');
  }

  if (existingSkill && existingSkill.trustScore >= 0.5) {
    steps.push(`Reutilizar skill de confiança: "${existingSkill.name}"`);
  }

  if (intentLevel === 'critical') {
    steps.push('Requer confirmação humana explícita antes de executar');
  }

  return {
    steps,
    route: routeMeta?.route || 'local',
    reason: routeMeta?.reason || 'Processamento local',
    intentLevel,
    simulation: `Este comando irá: ${steps.join(' → ')}`,
  };
}

function getToolArguments(call, confirmed) {
  const builder = TOOL_ARGUMENT_BUILDERS[call.tool];
  return builder ? builder(call.args, confirmed) : Object.values(call.args);
}

function extractFirstJsonObject(text) {
  const fencedMatch = text.match(/```json\s*([\s\S]+?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return candidate.slice(start, index + 1);
    }
  }

  return null;
}

function parseToolCalls(text) {
  const parsed = parseJsonText(text);
  if (parsed?.toolCalls && Array.isArray(parsed.toolCalls)) {
    return parsed.toolCalls;
  }
  return [];
}

function parseJsonText(text) {
  if (!text) return null;
  const jsonSlice = extractFirstJsonObject(text);
  if (!jsonSlice) return null;
  try {
    return JSON.parse(jsonSlice);
  } catch {
    return null;
  }
}

function resolveApiKeys(apiKeys = {}) {
  return {
    gemini: apiKeys.gemini || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
    openrouter: apiKeys.openrouter || process.env.OPENROUTER_API_KEY || '',
    openai: apiKeys.openai || process.env.OPENAI_API_KEY || '',
  };
}

async function callGemini({ systemPrompt, command, apiKeys }) {
  if (!apiKeys.gemini) {
    return null;
  }

  let lastError = null;

  for (const model of GEMINI_MODEL_CHAIN) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKeys.gemini}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: command }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
        }),
      });

      if (!response.ok) {
        lastError = new Error(`Gemini ${model} -> ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || '')
        .join('\n')
        .trim();

      if (text) {
        return { text, provider: 'gemini', model };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function callOpenRouter({ systemPrompt, command, apiKeys }) {
  if (!apiKeys.openrouter) {
    return null;
  }

  const model = process.env.KAZE_OPENROUTER_MODEL || 'anthropic/claude-3.7-sonnet';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeys.openrouter}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: command },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenRouter sem resposta');
  }

  return { text, provider: 'openrouter', model };
}

async function callOpenAI({ systemPrompt, command, apiKeys }) {
  if (!apiKeys.openai) {
    return null;
  }

  const model = process.env.KAZE_OPENAI_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeys.openai}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: command },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenAI sem resposta');
  }

  return { text, provider: 'openai', model };
}

async function callLLM({ systemPrompt, command, apiKeys }) {
  const resolvedKeys = resolveApiKeys(apiKeys);
  const errors = [];

  for (const providerCall of [callGemini, callOpenRouter, callOpenAI]) {
    try {
      const result = await providerCall({ systemPrompt, command, apiKeys: resolvedKeys });
      if (result?.text) {
        return result;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!resolvedKeys.gemini && !resolvedKeys.openrouter && !resolvedKeys.openai) {
    return {
      text: 'Nenhuma chave de IA configurada para o Kaze Core.',
      provider: 'none',
      model: 'none',
    };
  }

  throw new Error(errors.join(' | ') || 'Falha ao contactar o modelo');
}

function heuristicRouteFallback(command) {
  const normalized = command.toLowerCase();

  if (/(github|research|pesquisa|documenta|documentação|pull request|issue|repo)/i.test(normalized)) {
    return { route: 'hermes', intentLevel: classifyIntent(command), reason: 'Pedido favorece skill externa do Hermes.' };
  }

  if (/(passo a passo|multi-step|autónom|autonom|continua até|faz tudo)/i.test(normalized)) {
    return { route: 'auto', intentLevel: classifyIntent(command), reason: 'Pedido explícito de execução multi-step.' };
  }

  return { route: 'local', intentLevel: classifyIntent(command), reason: 'Fallback local.' };
}

async function routeCommandWithLLM(command, apiKeys) {
  const systemPrompt = `
És o router inteligente do KAZE Core.
Decide a melhor rota para um comando administrativo.

Responde APENAS JSON:
{
  "route": "local" | "hermes" | "hybrid" | "auto",
  "intentLevel": "safe" | "sensitive" | "critical",
  "reason": "texto curto",
  "confidence": 0.0
}

Regras:
- "local": ficheiros permitidos, emails, rede interna, música.
- "hermes": GitHub, research, documentação, produtividade externa.
- "hybrid": quando precisa do Kaze local + Hermes.
- "auto": quando o pedido exige várias iterações de planear → executar → observar.
- Acções destrutivas ou de escrita importante devem ser "critical".
`;

  try {
    const result = await callLLM({ systemPrompt, command, apiKeys });
    const parsed = parseJsonText(result.text);
    if (parsed?.route && parsed?.intentLevel) {
      return {
        route: parsed.route,
        intentLevel: parsed.intentLevel,
        reason: parsed.reason || 'Classificado pelo router inteligente.',
        confidence: Number(parsed.confidence || 0),
        modelUsed: result.model,
        provider: result.provider,
      };
    }
  } catch {
    // fallback abaixo
  }

  return heuristicRouteFallback(command);
}

async function planAutoStep({ originalCommand, history, apiKeys }) {
  const systemPrompt = `
És o auto-operador do KAZE Core.
Planeia apenas o PRÓXIMO passo seguro com base no pedido original e no histórico.

Responde APENAS JSON:
{
  "done": false,
  "executor": "local" | "hermes",
  "stepCommand": "comando objectivo do próximo passo",
  "reason": "texto curto"
}

Se já terminou:
{
  "done": true,
  "finalResponse": "resumo final"
}
`;

  const userPrompt = JSON.stringify({
    originalCommand,
    history: history.map((entry) => ({
      iteration: entry.iteration,
      plan: entry.plan,
      execution: {
        response: entry.execution?.response,
        route: entry.execution?.route,
        error: entry.execution?.error,
      },
    })),
  });

  const result = await callLLM({ systemPrompt, command: userPrompt, apiKeys });
  const parsed = parseJsonText(result.text);

  if (parsed?.done) {
    return { done: true, finalResponse: parsed.finalResponse || 'Execução concluída.' };
  }

  if (parsed?.executor && parsed?.stepCommand) {
    return parsed;
  }

  return {
    done: history.length > 0,
    finalResponse: history.length > 0 ? 'Auto-operador concluiu sem novo passo válido.' : null,
  };
}

async function observeAutoStep({ originalCommand, history, apiKeys }) {
  const lastEntry = history[history.length - 1];
  if (!lastEntry) {
    return { done: false };
  }

  const systemPrompt = `
Observa o último passo do KAZE Core e decide se a tarefa principal já terminou.

Responde APENAS JSON:
{
  "done": true | false,
  "finalResponse": "se done=true, resumo final"
}
`;

  const userPrompt = JSON.stringify({
    originalCommand,
    lastStep: {
      plan: lastEntry.plan,
      execution: {
        response: lastEntry.execution?.response,
        error: lastEntry.execution?.error,
        route: lastEntry.execution?.route,
      },
    },
  });

  try {
    const result = await callLLM({ systemPrompt, command: userPrompt, apiKeys });
    const parsed = parseJsonText(result.text);
    if (typeof parsed?.done === 'boolean') {
      return parsed;
    }
  } catch {
    // fallback abaixo
  }

  if (lastEntry.execution?.error) {
    return { done: history.length >= 2, finalResponse: 'Auto-operador parou após erro repetido.' };
  }

  return { done: false };
}

async function executeToolCall(call, { confirmed, intentLevel }) {
  const validation = validateToolCall(call);
  if (!validation.valid) {
    return {
      blocked: true,
      error: validation.reason,
      finalText: `❌ Tool rejeitada: ${validation.reason}`,
    };
  }

  const policy = enforcePolicy(call);
  if (policy.blocked) {
    return {
      blocked: true,
      error: policy.reason,
      finalText: `🚫 Política bloqueou: ${policy.reason}`,
    };
  }

  const [toolName, method] = call.tool.split('.');
  const tool = TOOLS[toolName];
  const result = await tool[method](...getToolArguments(call, confirmed));

  auditLog({ action: method, tool: toolName, input: call.args, result, level: intentLevel });

  if (result?.error) {
    return {
      blocked: false,
      error: result.error,
      result,
      finalText: `❌ ${call.tool}: ${result.error}`,
    };
  }

  if (result?.requiresConfirmation) {
    return {
      blocked: false,
      result,
      finalText: `⚠️ Requer confirmação: ${result.action}`,
    };
  }

  return {
    blocked: false,
    result,
    finalText: `✅ ${call.tool}: concluído`,
  };
}

async function executeLocalFlow({
  command,
  confirmed,
  apiKeys,
  intentLevel,
  existingSkill,
  pastContext,
  longMemory,
  plan,
  routeMeta,
}) {
  const soulPath = path.join(__dirname, 'brain/SOUL.md');
  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';

  const systemPrompt = `
${soul}

CONTEXTO DE EXECUÇÃO: KAZE CORE LOCAL
Ferramentas locais: ficheiros autorizados, rede interna, email, música e ponte Hermes.
Rota escolhida: ${routeMeta?.route || 'local'}.
Justificação da rota: ${routeMeta?.reason || 'local'}.
Memória de preferências: ${JSON.stringify(longMemory.preferences)}
Skill relevante: ${existingSkill ? `"${existingSkill.name}" (trust ${existingSkill.trustScore?.toFixed(2)})` : 'nenhuma'}
Contexto de sessões passadas: ${JSON.stringify(pastContext.slice(0, 1))}
Plano aprovado: ${JSON.stringify(plan.steps)}
Nível de intenção: ${intentLevel}
Confirmação: ${confirmed}
Máximo de tool calls: ${MAX_TOOLS_PER_COMMAND}

Quando precisares de ferramentas, responde no fim com um bloco JSON:
\`\`\`json
{"toolCalls":[{"tool":"file.listDir","args":{"dirPath":"kaze-workspace"}}]}
\`\`\`

Tools disponíveis:
- file.readFile(filePath)
- file.writeFile(filePath, content)
- file.deleteFile(filePath)
- file.createFolder(dirPath)
- network.get(url, headers?)
- network.post(url, body, headers?)
- email.sendEmail(to, subject, body)
- music.playMusic(searchOrUrl)
- hermes.execute(task, skill?, dryRun?, context?)
`;

  const llmResult = await callLLM({ systemPrompt, command, apiKeys });
  const toolsUsed = [];
  const errors = [];
  let finalResponse = llmResult.text.replace(/```json[\s\S]*?```/g, '').trim();
  let lastToolResult = null;

  const toolCalls = parseToolCalls(llmResult.text);
  for (const call of toolCalls) {
    if (incrementToolCount() > MAX_TOOLS_PER_COMMAND) {
      finalResponse += `\n⚠️ Limite de ${MAX_TOOLS_PER_COMMAND} ferramentas atingido.`;
      break;
    }

    const executed = await executeToolCall(call, { confirmed, intentLevel });
    if (executed.error) {
      errors.push(executed.error);
    }

    finalResponse += `\n${executed.finalText}`;
    if (executed.result) {
      lastToolResult = executed.result;
    }

    toolsUsed.push(call.tool);
  }

  return {
    response: finalResponse || 'Sem resposta.',
    toolsUsed,
    plan,
    intentLevel,
    route: routeMeta?.route || 'local',
    routeReason: routeMeta?.reason,
    modelUsed: llmResult.model,
    provider: llmResult.provider,
    toolResult: lastToolResult,
    errors,
  };
}

async function processCommand(payload, options = {}) {
  const { command, confirmed = false, apiKeys = {}, maxIterations = 10, mode = 'smart' } = payload || {};

  if (typeof command !== 'string' || command.length > 2000) {
    return { response: 'Comando inválido.', toolsUsed: [] };
  }

  resetCommandContext();

  const pastContext = memory.searchPastSessions(command);
  const existingSkill = memory.findRelevantSkill(command);
  const longMemory = memory.loadLongTermMemory();
  const resolvedKeys = resolveApiKeys(apiKeys);

  let routeMeta;
  if (options.forcedRoute) {
    routeMeta = {
      route: options.forcedRoute,
      intentLevel: classifyIntent(command),
      reason: 'Rota forçada internamente.',
    };
  } else if (mode === 'auto') {
    routeMeta = {
      route: 'auto',
      intentLevel: classifyIntent(command),
      reason: 'Modo auto solicitado pelo cliente.',
    };
  } else {
    routeMeta = await routeCommandWithLLM(command, resolvedKeys);
  }

  const intentLevel = routeMeta.intentLevel || classifyIntent(command);
  const plan = buildPlan(command, { intentLevel, existingSkill, routeMeta });

  if (intentLevel === 'critical' && !confirmed) {
    return {
      requiresConfirmation: true,
      action: command,
      plan,
      simulation: plan.simulation,
      route: routeMeta.route,
      routeReason: routeMeta.reason,
    };
  }

  let result;

  if (routeMeta.route === 'hermes') {
    const hermesResult = await hermesService.execute(command, { dryRun: false, context: { source: 'kaze-core' } });
    result = {
      response: hermesResult.response || hermesResult.error || 'Hermes executado.',
      toolsUsed: ['hermes.execute'],
      plan,
      intentLevel,
      route: 'hermes',
      routeReason: routeMeta.reason,
      toolResult: hermesResult,
      errors: hermesResult.success ? [] : [hermesResult.error || 'Hermes indisponível'],
    };
  } else if (routeMeta.route === 'auto') {
    const autoResult = await runAutoOperator({
      command,
      maxIterations,
      planStep: ({ history }) => planAutoStep({ originalCommand: command, history, apiKeys: resolvedKeys }),
      executeStep: async ({ plan: nextPlan }) => {
        if (nextPlan.executor === 'hermes') {
          const hermesResult = await hermesService.execute(nextPlan.stepCommand, {
            dryRun: false,
            context: { source: 'kaze-auto', originalCommand: command },
          });
          return {
            route: 'hermes',
            response: hermesResult.response || hermesResult.error || 'Hermes executado.',
            raw: hermesResult,
            error: hermesResult.success ? null : hermesResult.error,
          };
        }

        const localResult = await processCommand(
          { command: nextPlan.stepCommand, confirmed: true, apiKeys: resolvedKeys, mode: 'smart' },
          { forcedRoute: 'local' },
        );

        return {
          route: 'local',
          response: localResult.response,
          raw: localResult,
          error: localResult.errors?.[0] || null,
        };
      },
      observeStep: ({ history }) => observeAutoStep({ originalCommand: command, history, apiKeys: resolvedKeys }),
    });

    result = {
      response: autoResult.response,
      toolsUsed: autoResult.iterations.flatMap((entry) => entry.execution?.raw?.toolsUsed || []),
      plan,
      intentLevel,
      route: 'auto',
      routeReason: routeMeta.reason,
      steps: autoResult.iterations,
      errors: autoResult.completed ? [] : ['Auto-operador terminou com limite ou bloqueio'],
    };
  } else {
    result = await executeLocalFlow({
      command,
      confirmed,
      apiKeys: resolvedKeys,
      intentLevel,
      existingSkill,
      pastContext,
      longMemory,
      plan,
      routeMeta,
    });
  }

  memory.recordInteraction({
    role: 'exchange',
    content: `USER: ${command.substring(0, 300)} | KAZE: ${String(result.response || '').substring(0, 200)}`,
    toolsUsed: result.toolsUsed || [],
    result: result.errors?.length ? 'partial' : 'success',
  });

  if ((result.toolsUsed || []).length >= 3 && !(result.errors?.length)) {
    await memory.maybeCreateSkill({
      taskDescription: command,
      steps: (result.toolsUsed || []).map((toolName) => `Executou ${toolName}`),
      toolsUsed: result.toolsUsed || [],
      errors: [],
    });
  }

  return result;
}

module.exports = { processCommand, routeCommandWithLLM };
