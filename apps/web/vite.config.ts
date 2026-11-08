import { defineConfig } from 'vite';

export default defineConfig({ build: { rollupOptions: { input: { main: 'index.html', showcase: 'showcase.html' } } }, server: { host: '0.0.0.0', allowedHosts: ['.trycloudflare.com'], proxy: {
  '/watch': { target: 'http://localhost:3000' },
  '/session': { target: 'http://localhost:3000', ws: true },
  '/gladia': { target: 'http://localhost:3000', ws: true },
  '/ws': { target: 'http://localhost:3000', ws: true },
} } });
