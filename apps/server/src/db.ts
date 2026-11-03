// Adapted from OpenPurpose's apps/server/src/db.ts: the same pool that drops superuser rights
// and the same scoped transactions, for OpenRelay's networks.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

/**
 * Superusers and BYPASSRLS roles ignore row-level security. When OpenRelay connects as one
 * (the Docker default), every connection switches to the openrelay_app role first. If it
 * can't, the connection fails, so the server refuses to start rather than mix networks.
 */
const DROP_PRIVILEGES = `DO $$ BEGIN
  IF current_setting('is_superuser') <> 'on'
     AND NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  BEGIN
    EXECUTE 'SET ROLE openrelay_app';
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN
    RAISE EXCEPTION 'The database user % skips row-level security and can''t switch to the openrelay_app role, so networks could see each other''s data.', current_user
      USING HINT = format('Run the migrations as %I, or have an admin run: GRANT openrelay_app TO %I', current_user, current_user);
  END;
END $$`;

const ready = new WeakSet<pg.PoolClient>();

export function createPool(databaseUrl: string): Pool {
  // Keep connections open: a new one costs TCP, TLS, authentication and DROP_PRIVILEGES.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 0 });
  pool.on('error', (err) => {
    console.warn(`Database connection dropped: ${err.message}`);
  });
  const connect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
  type Callback = (err: Error | undefined, client?: pg.PoolClient, done?: () => void) => void;
  // Every client drops privileges once, before its first use. pg's own pool.query calls
  // connect with a callback, so both forms are kept.
  const wrapped = (callback?: Callback) => {
    const checkedOut = connect().then(async (client) => {
      if (!ready.has(client)) {
        try {
          await client.query(DROP_PRIVILEGES);
        } catch (err) {
          client.release(err as Error);
          throw err;
        }
        ready.add(client);
      }
      return client;
    });
    if (!callback) return checkedOut;
    checkedOut.then(
      (client) => {
        callback(undefined, client, () => {
          client.release();
        });
      },
      (err: unknown) => {
        callback(err as Error);
      },
    );
    return undefined;
  };
  (pool as unknown as { connect: typeof wrapped }).connect = wrapped;
  return pool;
}

/** Which rows a transaction sees: one network's, or (bypass) every network's. */
export type Scope = { networkId: string } | { bypass: true };

/**
 * SQL that points row-level security at `scope` for the rest of the transaction. Literals
 * instead of parameters, so it can share one round trip with other statements.
 */
export function scopeSql(client: pg.ClientBase, scope: Scope): string {
  const network = 'networkId' in scope ? scope.networkId : '';
  const bypass = 'bypass' in scope ? 'on' : '';
  return `SELECT set_config('openrelay.network_id', ${client.escapeLiteral(network)}, true),
    set_config('openrelay.bypass', '${bypass}', true)`;
}

/** Runs `fn` in one transaction that sees only `scope`. */
export async function withScope<T>(
  pool: Pool,
  scope: Scope,
  fn: (db: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let ok = false;
  try {
    await client.query(`BEGIN; ${scopeSql(client, scope)}`);
    const result = await fn(client);
    ok = true;
    return result;
  } finally {
    await client
      .query(ok ? 'COMMIT' : 'ROLLBACK')
      .catch(() => undefined)
      .finally(() => {
        client.release();
      });
  }
}

/**
 * Applies every *.sql file in `dir` that hasn't been applied yet, in name order, as the
 * database owner (migrations need DDL).
 */
export async function migrate(databaseUrl: string, dir: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        // Serialise concurrent boots of several replicas.
        await client.query('SELECT pg_advisory_xact_lock(4244)');
        const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (!done.rowCount) {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
          applied.push(file);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    // Keep the app role's grants in step with the schema.
    await client.query(`
      GRANT USAGE ON SCHEMA public TO openrelay_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openrelay_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO openrelay_app;`);
    // A non-superuser owner may administer the role without being allowed to SET ROLE to it.
    await client
      .query(
        `DO $$ BEGIN
          SET ROLE openrelay_app;
          RESET ROLE;
        EXCEPTION WHEN insufficient_privilege THEN
          EXECUTE format('GRANT openrelay_app TO %I', current_user);
        END $$`,
      )
      .catch(() => undefined);
  } finally {
    await client.end();
  }
  return applied;
}
