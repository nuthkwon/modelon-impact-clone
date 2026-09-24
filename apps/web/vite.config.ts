import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port of the API server the dev proxy forwards to (the e2e suite runs the API on 8199).
const apiPort = process.env.API_PORT ?? 8080;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/libraries': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
