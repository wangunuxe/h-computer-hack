import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) });
