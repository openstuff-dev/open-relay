/** Settings from environment variables. Each has a default, so the server starts without any. */
export interface Config {
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trust = env.OPENRELAY_TRUST_PROXY ?? '';
  return {
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
  };
}
