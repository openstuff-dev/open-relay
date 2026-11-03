import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Config } from './config.js';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.get('/api/health', () => ({ status: 'ok' }));

  if (config.webDir) {
    await app.register(fastifyStatic, { root: config.webDir });
    // The web app routes in the browser, so any other page gets index.html.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  }

  return app;
}
