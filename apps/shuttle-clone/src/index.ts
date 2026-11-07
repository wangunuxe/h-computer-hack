import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();
app.get('/', (c) => c.text('Voilà shuttle clone — TODO'));
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) });
