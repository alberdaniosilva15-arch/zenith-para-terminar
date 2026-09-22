import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function zenithDevQrPlugin() {
  let currentNetworkUrl: string | null = null;
  let currentLocalUrl: string | null = null;

  return {
    name: 'zenith-dev-qr',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/__dev/network-url', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          networkUrl: currentNetworkUrl,
          localUrl: currentLocalUrl,
        }));
      });

      server.httpServer?.once('listening', async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));

        currentNetworkUrl = server.resolvedUrls?.network?.[0] ?? null;
        currentLocalUrl = server.resolvedUrls?.local?.[0] ?? null;

        if (!currentNetworkUrl) {
          return;
        }

        try {
          // @ts-ignore - qrcode-terminal does not ship TypeScript declarations
          const qrModule = await import('qrcode-terminal');
          const qrcodeTerminal = (qrModule as { default?: { generate: (url: string, options?: { small?: boolean }) => void }; generate?: (url: string, options?: { small?: boolean }) => void }).default ?? qrModule;

          console.log('\n[Zenith Ride] QR code de desenvolvimento:\n');
          qrcodeTerminal.generate(currentNetworkUrl, { small: true });
          console.log(`\n[Zenith Ride] Link de rede: ${currentNetworkUrl}\n`);
        } catch (error) {
          console.warn('[Zenith Ride] Não foi possível imprimir o QR code no terminal:', error);
        }
      });
    },
  };
}

export default defineConfig({
  appType: 'spa',
  cacheDir: 'node_modules/.vite-app',
  // ⚠️ SÓ `VITE_`. Nada de `GEMINI_`, `GROQ_`, `OPENAI_`, `OPENROUTER_`, `RESEND_`.
  //
  // O `envPrefix` decide que variáveis o Vite expõe ao browser. Estava assim:
  //     ['VITE_', 'GEMINI_', 'GROQ_', 'OPENAI_', 'OPENROUTER_', 'RESEND_']
  // e isso punha nomes de segredos do SERVIDOR ao alcance do cliente. Provado
  // no bundle: `RESEND_API_KEY` (a chave de email) aparecia dentro de
  // `dist-verify/assets/geminiService-*.js`.
  //
  // Pior: o `kazeKey.ts` lia `import.meta.env?.GROQ_API_KEY` com optional
  // chaining. O Vite não consegue substituir a propriedade estaticamente nesse
  // caso, por isso inlinava o objecto `import.meta.env` INTEIRO — e com ele
  // todos os segredos com prefixo. Foi por essa porta que o RESEND saiu.
  //
  // Regra que passa a valer: **só `VITE_` chega ao browser**, e nada com
  // prefixo `VITE_` pode ser um segredo. As chaves vivem nos secrets das Edge
  // Functions do Supabase e nas variáveis de ambiente do Vercel.
  envPrefix: ['VITE_'],
  plugins: [react(), zenithDevQrPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/src/app/AuthenticatedApp.tsx')) {
            return 'app-shell';
          }

          if (normalizedId.includes('/src/data/angolaLocations')) {
            return 'locations-db';
          }

          if (!normalizedId.includes('/node_modules/')) {
            return undefined;
          }

          if (normalizedId.includes('/mapbox-gl/')) return 'mapbox';
          if (normalizedId.includes('/agora-rtc-sdk-ng/')) return 'agora';
          if (normalizedId.includes('/recharts/')) return 'charts';
          if (normalizedId.includes('/html2canvas/')) return 'capture';
          if (normalizedId.includes('/h3-js/')) return 'h3';
          if (normalizedId.includes('/@supabase/supabase-js/')) return 'supabase';
          if (normalizedId.includes('/lucide-react/')) return 'icons';
          if (
            normalizedId.includes('/react-router-dom/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/react/')
          ) {
            return 'react-vendor';
          }

          return undefined;
        },
      },
    },
  },
});
