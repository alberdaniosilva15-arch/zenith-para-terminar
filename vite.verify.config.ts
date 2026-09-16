// =============================================================================
// ZENITH RIDE — vite.verify.config.ts
//
// Config EXCLUSIVA para verificar o bundle localmente, sem tocar em `dist/`.
//
// Porque existe:
//   O `npm run build` escreve em `dist/` e o Vite limpa esse directório antes
//   de escrever. Neste Windows o sandbox bloqueia a remoção de ficheiros, por
//   isso o build falhava sempre ao tentar esvaziar `dist/assets`.
//
// O que faz:
//   • reutiliza o `vite.config.ts` tal-e-qual (nenhuma regra é duplicada);
//   • escreve o resultado em `dist-verify/`;
//   • desliga `emptyOutDir`, para não apagar nada antes de construir.
//
// Uso:  npx vite build --config vite.verify.config.ts
// =============================================================================

import { defineConfig, type UserConfig } from 'vite';
import baseConfig from './vite.config';

export default defineConfig(async (env): Promise<UserConfig> => {
  const base = (typeof baseConfig === 'function'
    ? await baseConfig(env)
    : await baseConfig) as UserConfig;

  return {
    ...base,
    build: {
      ...base.build,
      outDir: 'dist-verify',
      emptyOutDir: false,
    },
  };
});
