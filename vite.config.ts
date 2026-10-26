/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// CI (GitHub's 4-vCPU runners, slower per core than the dev box): fewer test workers, so the heavy save-compat and
// season-long tests don't starve the runner (vitest's worker RPC times out after 60 s of a blocked event loop), and
// longer default timeouts. Every test still runs; perf budgets scale by PERF_BUDGET_FACTOR (src/test/perf.ts).
const ci = !!process.env.CI;

// EMBED=1 builds a variant for hosts where service workers are unavailable
// (sandboxed previews); the regular build ships the offline-capable PWA.
const embed = !!process.env.EMBED;

// Dev only: /dev-ref/<type>/<file>.png serves reference crops (DEV_REF_DIR, default ./dev-ref — a
// gitignored symlink to a scratch folder). Never part of a build.
const devRef = (): Plugin => ({
  name: 'dev-ref',
  apply: 'serve',
  configureServer(server) {
    const root = path.resolve(process.env.DEV_REF_DIR ?? 'dev-ref');
    server.middlewares.use('/dev-ref', (req, res, next) => {
      const m = /^\/([\w-]+)\/([\w-]+\.png)(?:\?.*)?$/.exec(req.url ?? '');
      if (!m) return next();
      readFile(path.join(root, m[1], m[2])).then(
        (buf) => { res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-store'); res.end(buf); },
        () => { res.statusCode = 404; res.end(); },
      );
    });
  },
});

export default defineConfig({
  base: './',
  // Lets several dev servers run side by side without sharing a dep cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  define: { __EMBED__: JSON.stringify(embed) },
  plugins: [
    react(),
    devRef(),
    VitePWA({
      disable: embed,
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.png', 'sounds/*.mp3', 'aircraft/*.webp', 'aircraft/*.png'],
      manifest: {
        name: 'BLOCK HOURS',
        short_name: 'Block Hours',
        description: 'Run an ACMI & charter airline: wet-lease aircraft, crew and contracts around the world.',
        theme_color: '#070b14',
        background_color: '#070b14',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // v0.9.1 the cabin chime samples play offline too; v0.10 the aircraft art (public/aircraft, WebP + mask PNGs).
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,json,mp3}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: { ...(ci ? { pool: 'forks' as const, maxWorkers: 2, minWorkers: 1, testTimeout: 30_000, hookTimeout: 60_000 } : {}) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
