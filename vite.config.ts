import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox:   ['mapbox-gl'],
          agora:    ['agora-rtc-sdk-ng'],
          charts:   ['recharts'],
          zustand:  ['zustand'],
          h3:       ['h3-js'],
          supabase: ['@supabase/supabase-js'],
          purify:   ['dompurify'],
        },
      },
    },
  },
});
