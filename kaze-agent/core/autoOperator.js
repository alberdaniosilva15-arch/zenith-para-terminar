async function runAutoOperator({
  command,
  maxIterations = 10,
  planStep,
  executeStep,
  observeStep,
}) {
  const safeIterations = Math.min(Math.max(Number(maxIterations) || 1, 1), 10);
  const history = [];

  for (let iteration = 1; iteration <= safeIterations; iteration += 1) {
    const plan = await planStep({ command, history, iteration });
    if (!plan || typeof plan !== 'object') {
      return {
        completed: false,
        iterations: history,
        response: 'O auto-operador não conseguiu gerar um plano válido.',
      };
    }

    if (plan.done) {
      return {
        completed: true,
        iterations: history,
        response: plan.finalResponse || 'Execução multi-step concluída.',
      };
    }

    const execution = await executeStep({ command, history, iteration, plan });
    history.push({
      iteration,
      plan,
      execution,
    });

    const observation = await observeStep({ command, history, iteration, plan, execution });
    if (observation?.done) {
      return {
        completed: true,
        iterations: history,
        response: observation.finalResponse || execution?.response || 'Execução multi-step concluída.',
      };
    }
  }

  return {
    completed: false,
    iterations: history,
    response: 'Execução multi-step interrompida pelo limite de segurança (10 iterações).',
  };
}

module.exports = { runAutoOperator };
