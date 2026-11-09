import type { FetchPolicy } from '@openstuff-dev/server';

/** Settings from environment variables. Each has a default, so the server starts without any. */
export interface Config {
  /** The release this image was built from, set by the image build. `unknown` for a local build. */
  appVersion: string;
  port: number;
  host: string;
  /** The built web app to serve next to the API, if any. */
  webDir: string | undefined;
  logLevel: string;
  databaseUrl: string;
  /** Where people reach OpenRelay. Used for cookies, label QR codes and links in emails. */
  publicUrl: string;
  /** The first admin's email and password. Without a password, one is made and logged once. */
  adminEmail: string;
  adminPassword: string | undefined;
  sessionDays: number;
  /** smtp:// or smtps:// URL. Without one, emails are written to the log instead. */
  smtpUrl: string | undefined;
  mailFrom: string;
  /** Days a parcel waits at the point before it's overdue. */
  holdDays: number;
  /** Days after a parcel is collected or cancelled that the customer's details are deleted. */
  retentionDays: number;
  /** A Nominatim-compatible search URL, to sort points by distance. Off by default. */
  geocoderUrl: string | undefined;
  /** Behind a reverse proxy: true, or the proxy's addresses. */
  trustProxy: boolean | string;
  /** Encrypts saved connection secrets. Without one, a key is made and kept in the database. */
  secretKey: string | undefined;
  /** OpenVersion and OpenAnnounce this server connects to. Set here, they win over the tab. */
  openVersion: {
    url: string | undefined;
    publicKey: string | undefined;
    /** Lets this server publish its own version to OpenVersion on start. Never sent to browsers. */
    deployToken: string | undefined;
  };
  openAnnounce: {
    url: string | undefined;
    publicKey: string | undefined;
    signingSecret: string | undefined;
  };
  /** `private` lets this server call internal addresses, such as an OpenVersion on your network. */
  fetch: 'public' | 'private';
  /** With `private`: only these hosts. Empty means any. */
  fetchAllow: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trust = env.OPENRELAY_TRUST_PROXY ?? '';
  return {
    appVersion: env.VERSION?.trim() || 'unknown',
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    webDir: env.WEB_DIR || undefined,
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: env.DATABASE_URL ?? 'postgres://openrelay:openrelay@localhost:5432/openrelay',
    publicUrl: (env.OPENRELAY_PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    adminEmail: (env.OPENRELAY_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase(),
    adminPassword: env.OPENRELAY_ADMIN_PASSWORD || undefined,
    sessionDays: Number(env.OPENRELAY_SESSION_DAYS ?? 30),
    smtpUrl: env.OPENRELAY_SMTP_URL || undefined,
    mailFrom: env.OPENRELAY_MAIL_FROM ?? 'OpenRelay <noreply@localhost>',
    holdDays: Number(env.OPENRELAY_HOLD_DAYS ?? 14),
    retentionDays: Number(env.OPENRELAY_RETENTION_DAYS ?? 90),
    geocoderUrl: env.OPENRELAY_GEOCODER_URL?.replace(/\/$/, '') || undefined,
    trustProxy: trust === 'true' ? true : trust || false,
    secretKey: env.OPENRELAY_SECRET_KEY || undefined,
    openVersion: {
      url: env.OPENRELAY_OPENVERSION_URL?.replace(/\/$/, '') || undefined,
      publicKey: env.OPENRELAY_OPENVERSION_PUBLIC_KEY || undefined,
      deployToken: env.OPENRELAY_OPENVERSION_DEPLOY_TOKEN || undefined,
    },
    openAnnounce: {
      url: env.OPENRELAY_OPENANNOUNCE_URL?.replace(/\/$/, '') || undefined,
      publicKey: env.OPENRELAY_OPENANNOUNCE_PUBLIC_KEY || undefined,
      signingSecret: env.OPENRELAY_OPENANNOUNCE_SIGNING_SECRET || undefined,
    },
    fetch: env.OPENRELAY_FETCH === 'private' ? 'private' : 'public',
    fetchAllow: (env.OPENRELAY_FETCH_ALLOW ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** The fetch policy integrations use, from OPENRELAY_FETCH and OPENRELAY_FETCH_ALLOW. */
export const policyFrom = (config: Config): FetchPolicy => ({
  mode: config.fetch,
  allow: config.fetchAllow,
  envPrefix: 'OPENRELAY',
});
