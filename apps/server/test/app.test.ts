import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureFirstAdmin } from '../src/bootstrap.js';
import type { Pool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { parseCsv } from '../src/csv.js';
import { renderEmail } from '../src/emails.js';
import { distanceKm } from '../src/points.js';

describe('settings', () => {
  it('starts with defaults when no variables are set', () => {
    expect(loadConfig({})).toMatchObject({
      appVersion: 'unknown',
      port: 8080,
      host: '0.0.0.0',
      publicUrl: 'http://localhost:8080',
      adminEmail: 'admin@example.com',
      adminPassword: undefined,
      sessionDays: 30,
      smtpUrl: undefined,
      holdDays: 14,
      retentionDays: 90,
      geocoderUrl: undefined,
      trustProxy: false,
    });
  });

  it('reads the variables', () => {
    expect(
      loadConfig({
        VERSION: ' 1.4.0 ',
        OPENRELAY_PUBLIC_URL: 'https://relay.example.com/',
        OPENRELAY_ADMIN_EMAIL: 'Me@Example.com',
        OPENRELAY_HOLD_DAYS: '7',
        OPENRELAY_GEOCODER_URL: 'https://nominatim.example.com/',
        OPENRELAY_TRUST_PROXY: 'true',
      }),
    ).toMatchObject({
      publicUrl: 'https://relay.example.com',
      adminEmail: 'me@example.com',
      holdDays: 7,
      geocoderUrl: 'https://nominatim.example.com',
      trustProxy: true,
    });
  });
});

describe('health', () => {
  it('reports the version the image was built from, or unknown for a local build', async () => {
    // The health check only runs SELECT 1, so a stub pool is enough.
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
    const built = await buildApp({ ...loadConfig({ VERSION: '1.4.0' }), logLevel: 'silent' }, pool);
    const local = await buildApp({ ...loadConfig({}), logLevel: 'silent' }, pool);
    try {
      expect((await built.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ status: 'ok', version: '1.4.0' });
      expect((await local.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ status: 'ok', version: 'unknown' });
    } finally {
      await built.close();
      await local.close();
    }
  });
});

describe('CSV', () => {
  it('reads quotes, line breaks in quotes and semicolons', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('﻿name;email\nAnn;a@b.c')).toEqual([['name', 'email'], ['Ann', 'a@b.c']]);
    expect(parseCsv('a\n"two\nlines"')).toEqual([['a'], ['two\nlines']]);
  });
});

describe('emails', () => {
  it('puts the pickup code and opening hours in the ready email, escaped', () => {
    const email = renderEmail('at_point', {
      customerName: 'Mia <b>',
      merchant: 'Nordic Knits',
      reference: '#1',
      code: '7K3MQ9XD',
      point: { name: 'Corner Shop', street: 'A 1', postcode: '2200', city: 'Cph', openingHours: ['9–17', '', '', '', '', '', 'closed'] },
      trackingUrl: 'https://relay.example/t/abc',
      pickupCode: '123456',
      holdUntil: new Date('2026-11-17T12:00:00Z'),
    });
    expect(email.subject).toBe('Your order #1 from Nordic Knits is ready to collect');
    expect(email.text).toContain('123456');
    expect(email.text).toContain('Sunday: closed');
    expect(email.text).toContain('by Tuesday 17 November');
    expect(email.html).toContain('Mia &lt;b&gt;');
  });
});

describe('distance', () => {
  it('measures as the crow flies', () => {
    const km = distanceKm({ lat: 55.6893, lng: 12.5528 }, { lat: 55.6717, lng: 12.5627 });
    expect(km).toBeGreaterThan(1.9);
    expect(km).toBeLessThan(2.2);
  });
});

describe('a file that is missing', () => {
  it('answers 404, not the web app, and unknown pages still get the web app', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>app</title>');
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
    const app = await buildApp({ ...loadConfig({}), webDir, logLevel: 'silent' }, pool);
    try {
      const chunk = await app.inject({ url: '/chunk-missing.js?v=1' });
      expect(chunk.statusCode).toBe(404);
      expect(chunk.headers['content-type']).toContain('application/json');
      const page = await app.inject({ url: '/settings' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
    } finally {
      await app.close();
      rmSync(webDir, { recursive: true, force: true });
    }
  });
});

describe('first admin', () => {
  it('says where to change the password that it logs once', async () => {
    const warn = vi.fn();
    const pool = {
      query: vi.fn(() => Promise.resolve({ rows: [{ any: false }] })),
    } as unknown as Pool;
    const log = { warn, info: vi.fn() } as unknown as FastifyBaseLogger;
    await ensureFirstAdmin(pool, loadConfig({}), log);
    expect(warn.mock.calls[0]?.[0]).toContain('change it under Settings');
    expect(warn.mock.calls[0]?.[0]).not.toContain('top bar');
  });
});
