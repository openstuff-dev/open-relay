import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parseCsv } from '../src/csv.js';
import { renderEmail } from '../src/emails.js';
import { distanceKm } from '../src/points.js';

describe('settings', () => {
  it('starts with defaults when no variables are set', () => {
    expect(loadConfig({})).toMatchObject({
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
