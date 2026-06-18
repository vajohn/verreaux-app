import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

const certDir = path.resolve(__dirname, 'certs');
const certPath = path.join(certDir, 'local.pem');
const keyPath = path.join(certDir, 'local-key.pem');
const httpsConfig =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;

const BASE = '/verreaux-app/';

export default defineConfig({
  base: BASE,
  server: { host: true, https: httpsConfig, port: 5173 },
  preview: { host: true, https: httpsConfig, port: 4173 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'Verreaux',
        short_name: 'Verreaux',
        description: 'Offline manhwa reader',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#030303',
        background_color: '#030303',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE}icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('dexie')) return 'dexie';
            if (id.includes('@zip.js/zip.js')) return 'zipjs';
            if (id.includes('zustand')) return 'zustand';
            if (id.includes('react')) return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
