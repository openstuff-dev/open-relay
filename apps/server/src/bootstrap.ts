import type { FastifyBaseLogger } from 'fastify';
import { hashPassword, newPassword } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';

/**
 * Makes the first server admin when there is none yet, from OPENRELAY_ADMIN_EMAIL
 * and OPENRELAY_ADMIN_PASSWORD. Without a password, it makes one and logs it this once.
 */
export async function ensureFirstAdmin(
  pool: Pool,
  config: Config,
  log: FastifyBaseLogger,
): Promise<void> {
  const { rows } = await pool.query<{ any: boolean }>('SELECT EXISTS (SELECT 1 FROM accounts WHERE is_server_admin) AS any');
  if (rows[0]?.any) return;
  const password = config.adminPassword ?? newPassword();
  await pool.query(
    `INSERT INTO accounts (email, name, password_hash, is_server_admin) VALUES ($1, 'Admin', $2, true)
     ON CONFLICT (email) DO NOTHING`,
    [config.adminEmail, await hashPassword(password)],
  );
  if (config.adminPassword) log.info(`Created the first admin, ${config.adminEmail}.`);
  else {
    log.warn(
      `Created the first admin. Sign in as ${config.adminEmail} with the password ${password} ` +
      'and change it under your name in the top bar. This is shown once.',
    );
  }
}
