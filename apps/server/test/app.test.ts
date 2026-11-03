import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('server', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('answers the health check', async () => {
    app = await buildApp({ ...loadConfig({}), logLevel: 'silent' });
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>()).toEqual({ status: 'ok' });
  });

  it('starts with defaults when no variables are set', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      host: '0.0.0.0',
      webDir: undefined,
      logLevel: 'info',
    });
  });
});
