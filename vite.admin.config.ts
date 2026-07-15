import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const adminRoot = path.resolve(__dirname, 'admin-dev');

export default defineConfig({
  root: adminRoot,
  envDir: __dirname,
  appType: 'spa',
  cacheDir: 'node_modules/.vite-admin',
  plugins: [react()],
  publicDir: path.resolve(__dirname, 'public'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    port: 4000,
    strictPort: true,
    open: false,
    fs: {
      allow: [__dirname],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4000,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-admin'),
    sourcemap: 'hidden',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(adminRoot, 'index.html'),
    },
  },
});
