import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Role } from '@open-relay/contracts';
import {
  announceGroups,
  loadVault,
  publishVersionOnStart,
  registerIntegrationRoutes,
  type Vault,
} from '@openstuff-dev/server';
import Fastify, { type FastifyInstance } from 'fastify';
import { networkAccess, registerAuth, requireAccount } from './auth.js';
import { type Config, policyFrom } from './config.js';
import type { Pool } from './db.js';
import { registerErrorHandler } from './errors.js';
import { registerIdempotency } from './idempotency.js';
import { integrationOffers } from './integrations.js';
import { registerApiRoutes } from './routes/api.js';
import { registerNetworkRoutes } from './routes/networks.js';
import { registerParcelRoutes } from './routes/parcels.js';
import { registerPlaceRoutes } from './routes/places.js';
import { registerTransferRoutes } from './routes/transfer.js';

/** Every role: anyone in a network may read their own OpenAnnounce token. */
const ALL_ROLES: readonly Role[] = ['admin', 'merchant', 'courier', 'point'];

export async function buildApp(config: Config, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy });
  registerErrorHandler(app);
  await app.register(fastifyCookie);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', version: config.appVersion };
  });

  registerAuth(app, pool, config);
  registerIdempotency(app);
  registerNetworkRoutes(app, pool);
  registerPlaceRoutes(app, pool, config);
  registerParcelRoutes(app, pool, config);
  registerApiRoutes(app, pool, config);
  registerTransferRoutes(app, pool);

  // The key is opened on first use, so a server that never saves a connection doesn't need one.
  let vault: Promise<Vault> | undefined;
  const openVault = () => {
    vault ??= loadVault(pool, {
      secret: config.secretKey,
      envName: 'OPENRELAY_SECRET_KEY',
      settingName: 'secret_key',
      log: app.log,
    }).catch((err: unknown) => {
      vault = undefined;
      throw err;
    });
    return vault;
  };
  const offers = integrationOffers(config);
  registerIntegrationRoutes(app, {
    db: pool,
    vault: openVault,
    policy: policyFrom(config),
    origin: new URL(config.publicUrl).origin,
    appName: 'OpenRelay',
    offers,
    isServerAdmin: (request) => requireAccount(request).isServerAdmin,
    // OpenAnnounce sees the account's id and the groups for the network in `?network=`, never a
    // name or an email. Someone not in that network gets 404 from networkAccess.
    announceUser: async (request) => {
      if (!request.account) return null;
      const { network } = request.query as { network?: unknown };
      if (typeof network !== 'string' || !network) return { sub: request.account.id, groups: [] };
      const access = await networkAccess(pool, request, network, ALL_ROLES);
      return { sub: request.account.id, groups: announceGroups(network, access.role) };
    },
  });
  const [versionOffer] = offers;
  publishVersionOnStart(app, {
    db: pool,
    vault: openVault,
    offer: versionOffer,
    policy: policyFrom(config),
    appName: 'OpenRelay',
    version: config.appVersion,
  });

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
