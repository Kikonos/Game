import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// EMBED=1 builds a variant for hosts where service workers are unavailable
// (sandboxed previews); the regular build ships the offline-capable PWA.
const embed = !!process.env.EMBED;

export default defineConfig({
  base: './',
  // Lets several dev servers run side by side without sharing a dep cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  define: { __EMBED__: JSON.stringify(embed) },
  plugins: [
    react(),
    VitePWA({
      disable: embed,
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'CONTRAIL — Airline Empire',
        short_name: 'Contrail',
        description: 'Build and run your own airline: real aircraft, real airports, a living market.',
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
