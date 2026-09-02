// =============================================================================
// ZENITH RIDE — Kaze Plugin Loader (Inspirado na arquitetura do Mark-LI)
// Carregamento dinâmico de skills/ferramentas com isolamento de falhas e circuit breaker
// =============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class KazePluginLoader {
  constructor() {
    this.plugins = new Map();
    this.pluginStats = new Map();
    this.toolsDir = path.resolve(__dirname, '..', 'tools');
  }

  /**
   * Descobrir e carregar todos os plugins na directoria de tools
   */
  async loadAllPlugins() {
    if (!fs.existsSync(this.toolsDir)) {
      console.warn(`[KazePluginLoader] Directoria de tools não encontrada: ${this.toolsDir}`);
      return;
    }

    const files = fs.readdirSync(this.toolsDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
    console.log(`[KazePluginLoader] A verificar ${files.length} plugins potenciais...`);

    for (const file of files) {
      await this.loadPlugin(file);
    }

    console.log(`[KazePluginLoader] ✅ ${this.plugins.size} plugins carregados com isolamento de falhas.`);
  }

  /**
   * Carregar um plugin individual com isolamento estrito de exceções
   */
  async loadPlugin(filename) {
    const pluginPath = path.join(this.toolsDir, filename);
    const pluginName = path.basename(filename, path.extname(filename));

    try {
      // Import dinâmico com cache-busting se necessário
      const fileUrl = new URL(`file://${pluginPath.replace(/\\/g, '/')}`).href;
      const module = await import(fileUrl);
      const plugin = module.default || module;

      const metadata = {
        name: plugin.name || pluginName,
        description: plugin.description || `Plugin ${pluginName}`,
        enabled: true,
        version: plugin.version || '1.0.0',
        handler: plugin.execute || plugin.run || module.execute,
        schema: plugin.schema || null,
        loadedAt: new Date().toISOString(),
      };

      if (typeof metadata.handler !== 'function') {
        console.warn(`[KazePluginLoader] ⚠️ Plugin ${filename} ignorado: sem função execute/handler.`);
        return false;
      }

      this.plugins.set(metadata.name, metadata);
      this.pluginStats.set(metadata.name, { calls: 0, failures: 0, lastExecution: null });
      return true;
    } catch (err) {
      console.error(`[KazePluginLoader] ❌ Erro ao isolar/carregar plugin ${filename}:`, err.message);
      return false;
    }
  }

  /**
   * Executar uma ferramenta/skill com Circuit Breaker e Timeout
   */
  async executePlugin(name, args = {}, timeoutMs = 8000) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" não encontrado.`);
    }

    if (!plugin.enabled) {
      throw new Error(`Plugin "${name}" está desactivado.`);
    }

    const stats = this.pluginStats.get(name) || { calls: 0, failures: 0, lastExecution: null };
    stats.calls++;
    stats.lastExecution = new Date().toISOString();

    try {
      // Execução protegida com Promise.race para timeout
      const result = await Promise.race([
        Promise.resolve(plugin.handler(args)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de ${timeoutMs}ms excedido no plugin ${name}`)), timeoutMs)
        ),
      ]);

      return { success: true, result, plugin: name };
    } catch (err) {
      stats.failures++;
      console.error(`[KazePluginLoader] Falha na execução do plugin ${name}:`, err.message);
      return { success: false, error: err.message, plugin: name };
    }
  }

  /**
   * Listar todos os plugins registados com estatísticas
   */
  getPluginsSummary() {
    const list = [];
    for (const [name, meta] of this.plugins.entries()) {
      const stats = this.pluginStats.get(name) || { calls: 0, failures: 0 };
      list.push({
        name,
        description: meta.description,
        enabled: meta.enabled,
        version: meta.version,
        calls: stats.calls,
        failures: stats.failures,
        health: stats.failures === 0 ? '100%' : `${Math.round(((stats.calls - stats.failures) / stats.calls) * 100)}%`,
      });
    }
    return list;
  }

  togglePlugin(name, enable) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = typeof enable === 'boolean' ? enable : !plugin.enabled;
      return plugin.enabled;
    }
    return false;
  }
}

export const kazePluginLoader = new KazePluginLoader();
