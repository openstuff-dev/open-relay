import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerIntegrationRoutes, type Queryable } from '@openstuff-dev/server';
import { loadConfig, policyFrom } from '../src/config.js';
import { integrationOffers } from '../src/integrations.js';

describe('server connections', () => {
  it('offers no connection until a variable sets one', () => {
    const config = loadConfig({});
    expect(config.openVersion).toEqual({
      url: undefined,
      publicKey: undefined,
      deployToken: undefined,
    });
    expect(config.fetch).toBe('public');
    expect(integrationOffers(config).map((offer) => offer.environment)).toEqual([null, null]);
  });

  it('reads the connection variables and trims the address', () => {
    const config = loadConfig({
      OPENRELAY_OPENVERSION_URL: 'https://versions.example.com/',
      OPENRELAY_OPENVERSION_PUBLIC_KEY: 'ov_pub_12345678',
      OPENRELAY_OPENANNOUNCE_URL: 'https://news.example.com',
      OPENRELAY_OPENANNOUNCE_PUBLIC_KEY: 'pk_news_12345678',
      OPENRELAY_OPENANNOUNCE_SIGNING_SECRET: 'signing-secret-value',
      OPENRELAY_FETCH: 'private',
      OPENRELAY_FETCH_ALLOW: ' Versions.Example.com , ,news.internal ',
    });
    expect(config.openVersion.url).toBe('https://versions.example.com');
    expect(config.fetchAllow).toEqual(['versions.example.com', 'news.internal']);
    expect(policyFrom(config)).toEqual({
      mode: 'private',
      allow: ['versions.example.com', 'news.internal'],
      envPrefix: 'OPENRELAY',
    });
  });

  it('keeps the OpenAnnounce signing secret out of the OpenVersion offer', () => {
    const offers = integrationOffers(
      loadConfig({
        OPENRELAY_OPENVERSION_URL: 'https://versions.example.com',
        OPENRELAY_OPENVERSION_PUBLIC_KEY: 'ov_pub_12345678',
        OPENRELAY_OPENANNOUNCE_URL: 'https://news.example.com',
        OPENRELAY_OPENANNOUNCE_PUBLIC_KEY: 'pk_news_12345678',
        OPENRELAY_OPENANNOUNCE_SIGNING_SECRET: 'signing-secret-value',
      }),
    );
    const [version, announce] = offers;
    expect(version.signingSecret).toBe(false);
    expect(version.deployToken).toBe(true);
    expect(version.environment).toEqual({ url: 'https://versions.example.com', publicKey: 'ov_pub_12345678' });
    expect(announce.signingSecret).toBe(true);
    expect(announce.environment?.signingSecret).toBe('signing-secret-value');
  });

  it('UC-5/S5 answers 409 when the server configuration sets the connection', async () => {
    const rows: Record<string, unknown>[] = [];
    const db: Queryable = {
      query: (text: string) =>
        Promise.resolve({ rows: /^\s*SELECT/i.test(text) ? rows.slice(0, 1) : [] }),
    };
    const config = loadConfig({
      OPENRELAY_OPENANNOUNCE_URL: 'https://news.example.com',
      OPENRELAY_OPENANNOUNCE_PUBLIC_KEY: 'pk_news_12345678',
      OPENRELAY_OPENANNOUNCE_SIGNING_SECRET: 'signing-secret-value',
    });
    const app = Fastify();
    registerIntegrationRoutes(app, {
      db,
      vault: () =>
        Promise.reject(new Error('the vault must not be opened for an environment connection')),
      policy: policyFrom(config),
      origin: 'https://relay.example.com',
      appName: 'OpenRelay',
      offers: integrationOffers(config),
      isServerAdmin: () => true,
    });

    const list = await app.inject({ method: 'GET', url: '/api/admin/integrations' });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('signing-secret-value');
    expect(list.json()).toContainEqual(
      expect.objectContaining({ kind: 'openannounce', status: 'set-by-server', hasSigningSecret: true }),
    );

    const save = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openannounce',
      payload: { url: 'https://other.example.com', publicKey: 'pk_other_12345678' },
    });
    expect(save.statusCode).toBe(409);

    const config200 = await app.inject({ method: 'GET', url: '/api/client-config' });
    expect(config200.statusCode).toBe(200);
    expect(config200.body).not.toContain('signing-secret-value');
    await app.close();
  });

  it('UC-5/S6 refuses everyone but a server admin', async () => {
    const config = loadConfig({});
    const app = Fastify();
    registerIntegrationRoutes(app, {
      db: { query: () => Promise.resolve({ rows: [] }) },
      vault: () => Promise.reject(new Error('unused')),
      policy: policyFrom(config),
      origin: 'https://relay.example.com',
      appName: 'OpenRelay',
      offers: integrationOffers(config),
      isServerAdmin: () => false,
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/integrations' });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
