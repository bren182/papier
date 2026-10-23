import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Use our own sw.js so we can add a push event handler
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'Papier',
        short_name: 'Papier',
        description: 'Your personal workspace',
        start_url: '/',
        display: 'standalone',
        background_color: '#1a1917',
        theme_color: '#1a1917',
        orientation: 'portrait-primary',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png',            sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Search', url: '/?search=1', description: 'Open search' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Transform the lazy editor and database chunks at startup, so the first
    // page opened (and parallel e2e workers) don't wait on a cold build.
    warmup: { clientFiles: ['./src/editor/index.js', './src/components/database/index.js'] },
    proxy: {
      // e2e runs point this at their own throwaway server.
      '/api': process.env.PAPIER_API_URL ?? 'http://127.0.0.1:3000',
    },
  },
});
