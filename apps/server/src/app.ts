import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { registerErrorHandler } from './errors.js';
import { registerIdempotency } from './idempotency.js';
import { registerApiRoutes } from './routes/api.js';
import { registerNetworkRoutes } from './routes/networks.js';
import { registerParcelRoutes } from './routes/parcels.js';
import { registerPlaceRoutes } from './routes/places.js';
import { registerTransferRoutes } from './routes/transfer.js';

export async function buildApp(config: Config, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy });
  registerErrorHandler(app);
  await app.register(fastifyCookie);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  registerAuth(app, pool, config);
  registerIdempotency(app);
  registerNetworkRoutes(app, pool);
  registerPlaceRoutes(app, pool, config);
  registerParcelRoutes(app, pool, config);
  registerApiRoutes(app, pool, config);
  registerTransferRoutes(app, pool);

  if (config.webDir) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    // The web app routes in the browser, so any other page gets index.html.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/') || /\.\w+$/.test(request.url.split('?')[0] ?? '')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return app;
}
