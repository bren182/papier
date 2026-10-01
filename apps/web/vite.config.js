import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
