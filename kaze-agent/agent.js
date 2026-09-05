const fs = require('fs');
const path = require('path');
const memory = require('./brain/kazeMemory');
const fileTool = require('./tools/fileTool');
const networkTool = require('./tools/networkTool');
const emailTool = require('./tools/emailTool');
const musicTool = require('./tools/musicTool');
const kazeEdgeService = require('./services/kazeEdgeService');
const { classifyIntent, auditLog } = require('./security/permissions');
const { enforcePolicy, resetCommandContext, incrementToolCount } = require('./security/executionPolicy');
const { runAutoOperator } = require('./core/autoOperator');

// TLS validation is always enforced. Removed perma-disable switch (security audit P0-4).
// If local dev needs per-request TLS bypass, configure it on a specific
// https.Agent instance, never globally via env var.

const MAX_TOOLS_PER_COMMAND = 5;
const GEMINI_MODEL_CHAIN = (
  process.env.KAZE_MODEL_CHAIN ||
  'models/gemini-2.5-flash'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const DEFAULT_OPENAI_MODEL = process.env.KAZE_OPENAI_MODEL || 'gpt-4.1-mini';
const DEFAULT_OPENROUTER_MODEL = process.env.KAZE_OPENROUTER_MODEL || 'anthropic/claude-3.7-sonnet';
const DEFAULT_ANTHROPIC_MODEL = process.env.KAZE_ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const DEFAULT_GROQ_MODEL = process.env.KAZE_GROQ_MODEL || 'llama-3.1-8b-instant';

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'gemini') return 'google';
  if (['google', 'openai', 'anthropic', 'openrouter', 'groq', 'custom'].includes(value)) return value;
  return null;
}

function normalizeGeminiModel(model) {
  const value = String(model || '').trim();
  if (!value) return null;
  return value.startsWith('models/') ? value : `models/${value}`;
}

function normalizeModelPreferences(modelPreferences = {}) {
  const provider = normalizeProvider(modelPreferences.provider);
  return {
    provider,
    model: String(modelPreferences.model || modelPreferences.modelOverride || '').trim(),
    baseUrl: String(modelPreferences.baseUrl || '').trim().replace(/\/+$/, ''),
  };
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function openAiCompatibleEndpoint(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

const TOOLS = {
  file: fileTool,
  network: networkTool,
  email: emailTool,
  music: musicTool,
  kazeEdge: {
    execute: (task, skill, dryRun = false, context = {}) =>
      kazeEdgeService.execute(task, { skill, dryRun, context }),
    listSkills: () => kazeEdgeService.listSkills(),
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
  'kazeEdge.execute': {
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
  'kazeEdge.execute': (args) => [args.task, args.skill, args.dryRun, args.context || {}],
};

function tokenizeForMatching(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function summarizeKazeEdgeSkills(command, kazeEdgeSkills) {
  const safeSkills = Array.isArray(kazeEdgeSkills) ? kazeEdgeSkills : [];
  const queryTokens = tokenizeForMatching(command);

  const rankedSkills = safeSkills
    .map((skill) => {
      const haystack = tokenizeForMatching(`${skill.name} ${skill.category} ${skill.source}`);
      const overlap = queryTokens.filter((token) => haystack.some((entry) => entry.includes(token) || token.includes(entry)));
      const boost = /(agent|agente|browser|github|vercel|openai|docs|skill|plugin|workflow|automation|deploy|chat)/i.test(
        `${skill.name} ${skill.category}`,
      )
        ? 1
        : 0;

      return {
        ...skill,
        score: overlap.length * 4 + boost,
      };
    })
    .sort((left, right) => right.score - left.score);

  const relevant = rankedSkills.filter((skill) => skill.score > 0).slice(0, 10);
  const categories = [...new Set(safeSkills.map((skill) => skill.category).filter(Boolean))];

  return {
    total: safeSkills.length,
    categories,
    relevant,
    strongMatch: relevant[0]?.score >= 4,
  };
}

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

  if (routeMeta?.route === 'kazeEdge') {
    steps.push(`Encaminhar para KazeEdge (${routeMeta.reason || 'skill externa'})`);
  } else if (routeMeta?.route === 'auto') {
    steps.push('Entrar em loop multi-step com observação contínua');
  } else if (routeMeta?.route === 'hybrid') {
    steps.push('Combinar tools locais com skills externas do KazeEdge');
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
    gemini: apiKeys.gemini || apiKeys.google || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
    google: apiKeys.google || apiKeys.gemini || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
    openrouter: apiKeys.openrouter || process.env.OPENROUTER_API_KEY || '',
    openai: apiKeys.openai || process.env.OPENAI_API_KEY || '',
    anthropic: apiKeys.anthropic || process.env.ANTHROPIC_API_KEY || '',
    groq: apiKeys.groq || process.env.GROQ_API_KEY || '',
    custom: apiKeys.custom || '',
  };
}

async function callGemini({ systemPrompt, command, apiKeys, modelPreferences }) {
  if (!apiKeys.gemini && !apiKeys.google) {
    return null;
  }

  let lastError = null;
  const preference = normalizeModelPreferences(modelPreferences);
  const modelChain = uniq([
    preference.provider === 'google' ? normalizeGeminiModel(preference.model) : null,
    ...GEMINI_MODEL_CHAIN,
  ]);
  const apiKey = apiKeys.gemini || apiKeys.google;

  for (const model of modelChain) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
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

async function callOpenRouter({ systemPrompt, command, apiKeys, modelPreferences }) {
  if (!apiKeys.openrouter) {
    return null;
  }

  const preference = normalizeModelPreferences(modelPreferences);
  const model = preference.provider === 'openrouter' && preference.model ? preference.model : DEFAULT_OPENROUTER_MODEL;
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

async function callOpenAI({ systemPrompt, command, apiKeys, modelPreferences }) {
  if (!apiKeys.openai) {
    return null;
  }

  const preference = normalizeModelPreferences(modelPreferences);
  const model = preference.provider === 'openai' && preference.model ? preference.model : DEFAULT_OPENAI_MODEL;
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

async function callGroq({ systemPrompt, command, apiKeys, modelPreferences }) {
  if (!apiKeys.groq) {
    return null;
  }

  const preference = normalizeModelPreferences(modelPreferences);
  const model = preference.provider === 'groq' && preference.model ? preference.model : DEFAULT_GROQ_MODEL;
  return callOpenAICompatible({
    systemPrompt,
    command,
    apiKey: apiKeys.groq,
    provider: 'groq',
    model,
    baseUrl: 'https://api.groq.com/openai/v1',
  });
}

async function callAnthropic({ systemPrompt, command, apiKeys, modelPreferences }) {
  if (!apiKeys.anthropic) {
    return null;
  }

  const preference = normalizeModelPreferences(modelPreferences);
  const model = preference.provider === 'anthropic' && preference.model ? preference.model : DEFAULT_ANTHROPIC_MODEL;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKeys.anthropic,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: command }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .map((part) => part?.text || '')
    .join('\n')
    .trim();
  if (!text) {
    throw new Error('Anthropic sem resposta');
  }

  return { text, provider: 'anthropic', model };
}

async function callOpenAICompatible({ systemPrompt, command, apiKey, provider, model, baseUrl }) {
  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  const endpoint = openAiCompatibleEndpoint(baseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`${provider} ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${provider} sem resposta`);
  }

  return { text, provider, model };
}

async function callCustomProvider({ systemPrompt, command, apiKeys, modelPreferences }) {
  const preference = normalizeModelPreferences(modelPreferences);
  if (preference.provider !== 'custom' || !apiKeys.custom) {
    return null;
  }

  return callOpenAICompatible({
    systemPrompt,
    command,
    apiKey: apiKeys.custom,
    provider: 'custom',
    model: preference.model,
    baseUrl: preference.baseUrl,
  });
}

async function callLLM({ systemPrompt, command, apiKeys, modelPreferences }) {
  const resolvedKeys = resolveApiKeys(apiKeys);
  const errors = [];
  const preference = normalizeModelPreferences(modelPreferences);
  const providerCalls = {
    google: callGemini,
    openai: callOpenAI,
    anthropic: callAnthropic,
    openrouter: callOpenRouter,
    groq: callGroq,
    custom: callCustomProvider,
  };
  const providerOrder = uniq([
    preference.provider,
    'google',
    'openrouter',
    'openai',
    'anthropic',
    'groq',
    'custom',
  ]);

  for (const provider of providerOrder) {
    const providerCall = providerCalls[provider];
    if (!providerCall) continue;
    try {
      const result = await providerCall({ systemPrompt, command, apiKeys: resolvedKeys, modelPreferences: preference });
      if (result?.text) {
        return result;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!resolvedKeys.gemini && !resolvedKeys.openrouter && !resolvedKeys.openai && !resolvedKeys.anthropic && !resolvedKeys.groq && !resolvedKeys.custom) {
    return {
      text: 'Nenhuma chave de IA configurada para o Kaze Core.',
      provider: 'none',
      model: 'none',
    };
  }

  throw new Error(errors.join(' | ') || 'Falha ao contactar o modelo');
}

function heuristicRouteFallback(command, kazeEdgeContext = { strongMatch: false }) {
  const normalized = command.toLowerCase();

  if (/(github|research|pesquisa|documenta|documentação|pull request|issue|repo)/i.test(normalized)) {
    return { route: 'kazeEdge', intentLevel: classifyIntent(command), reason: 'Pedido favorece skill externa do KazeEdge.' };
  }

  if (/(passo a passo|multi-step|autónom|autonom|continua até|faz tudo)/i.test(normalized)) {
    return { route: 'auto', intentLevel: classifyIntent(command), reason: 'Pedido explícito de execução multi-step.' };
  }

  return { route: 'local', intentLevel: classifyIntent(command), reason: 'Fallback local.' };
}

async function routeCommandWithLLM(command, apiKeys, modelPreferences) {
  const systemPrompt = `
És o router inteligente do KAZE Core.
Decide a melhor rota para um comando administrativo.

Responde APENAS JSON:
{
  "route": "local" | "kazeEdge" | "hybrid" | "auto",
  "intentLevel": "safe" | "sensitive" | "critical",
  "reason": "texto curto",
  "confidence": 0.0
}

Regras:
- "local": ficheiros permitidos, emails, rede interna, música.
- "kazeEdge": GitHub, research, documentação, produtividade externa.
- "hybrid": quando precisa do Kaze local + KazeEdge.
- "auto": quando o pedido exige várias iterações de planear → executar → observar.
- Acções destrutivas ou de escrita importante devem ser "critical".
`;

  try {
    const result = await callLLM({ systemPrompt, command, apiKeys, modelPreferences });
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

async function planAutoStep({ originalCommand, history, apiKeys, modelPreferences }) {
  const systemPrompt = `
És o auto-operador do KAZE Core.
Planeia apenas o PRÓXIMO passo seguro com base no pedido original e no histórico.

Responde APENAS JSON:
{
  "done": false,
  "executor": "local" | "kazeEdge",
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

  const result = await callLLM({ systemPrompt, command: userPrompt, apiKeys, modelPreferences });
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

async function observeAutoStep({ originalCommand, history, apiKeys, modelPreferences }) {
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
    const result = await callLLM({ systemPrompt, command: userPrompt, apiKeys, modelPreferences });
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
  modelPreferences,
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
Ferramentas locais: ficheiros autorizados, rede interna, email, música e ponte KazeEdge.
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
- kazeEdge.execute(task, skill?, dryRun?, context?)
`;

  const llmResult = await callLLM({ systemPrompt, command, apiKeys, modelPreferences });
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
  const { command, confirmed = false, apiKeys = {}, modelPreferences = {}, maxIterations = 10, mode = 'smart' } = payload || {};

  if (typeof command !== 'string' || command.length > 2000) {
    return { response: 'Comando inválido.', toolsUsed: [] };
  }

  resetCommandContext();

  const pastContext = memory.searchPastSessions(command);
  const existingSkill = memory.findRelevantSkill(command);
  const longMemory = memory.loadLongTermMemory();
  const resolvedKeys = resolveApiKeys(apiKeys);
  const resolvedModelPreferences = normalizeModelPreferences(modelPreferences);

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
    routeMeta = await routeCommandWithLLM(command, resolvedKeys, resolvedModelPreferences);
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

  if (routeMeta.route === 'kazeEdge') {
    const kazeEdgeResult = await kazeEdgeService.execute(command, { dryRun: false, context: { source: 'kaze-core' } });
    result = {
      response: kazeEdgeResult.response || kazeEdgeResult.error || 'KazeEdge executado.',
      toolsUsed: ['kazeEdge.execute'],
      plan,
      intentLevel,
      route: 'kazeEdge',
      routeReason: routeMeta.reason,
      toolResult: kazeEdgeResult,
      errors: kazeEdgeResult.success ? [] : [kazeEdgeResult.error || 'KazeEdge indisponível'],
    };
  } else if (routeMeta.route === 'auto') {
    const autoResult = await runAutoOperator({
      command,
      maxIterations,
      planStep: ({ history }) => planAutoStep({ originalCommand: command, history, apiKeys: resolvedKeys, modelPreferences: resolvedModelPreferences }),
      executeStep: async ({ plan: nextPlan }) => {
        if (nextPlan.executor === 'kazeEdge') {
          const kazeEdgeResult = await kazeEdgeService.execute(nextPlan.stepCommand, {
            dryRun: false,
            context: { source: 'kaze-auto', originalCommand: command },
          });
          return {
            route: 'kazeEdge',
            response: kazeEdgeResult.response || kazeEdgeResult.error || 'KazeEdge executado.',
            raw: kazeEdgeResult,
            error: kazeEdgeResult.success ? null : kazeEdgeResult.error,
          };
        }

        const localResult = await processCommand(
          { command: nextPlan.stepCommand, confirmed: true, apiKeys: resolvedKeys, modelPreferences: resolvedModelPreferences, mode: 'smart' },
          { forcedRoute: 'local' },
        );

        return {
          route: 'local',
          response: localResult.response,
          raw: localResult,
          error: localResult.errors?.[0] || null,
        };
      },
      observeStep: ({ history }) => observeAutoStep({ originalCommand: command, history, apiKeys: resolvedKeys, modelPreferences: resolvedModelPreferences }),
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
      modelPreferences: resolvedModelPreferences,
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
