import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // e2e runs point this at their own throwaway server.
      '/api': process.env.PAPIER_API_URL ?? 'http://127.0.0.1:3000',
    },
  },
});
