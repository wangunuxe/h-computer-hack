import { defineConfig } from 'vite';

export default defineConfig({ server: { host: '0.0.0.0', allowedHosts: ['.trycloudflare.com'], proxy: {
  '/session': { target: 'http://localhost:3000', ws: true },
  '/gladia': { target: 'http://localhost:3000', ws: true },
  '/ws': { target: 'http://localhost:3000', ws: true },
} } });
