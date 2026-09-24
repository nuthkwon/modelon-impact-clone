// Temporary vite config for the restyle screenshot pass: proxies /api to the server on 8093.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8093', changeOrigin: true },
      '/libraries': { target: 'http://localhost:8093', changeOrigin: true },
    },
  },
});
