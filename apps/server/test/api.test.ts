import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { verifyUser } from '@openstuff-dev/announce/server';
import { vaultFor } from '@openstuff-dev/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  Me,
  NetworkExport,
  NewApiKey,
  Parcel,
  ParcelRow,
  ParcelsPage,
  PickupStop,
  Point,
  ScanRefused,
  ScanResult,
  SuggestedPoint,
  Tracking,
} from '@open-relay/contracts';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate, type Pool, withScope } from '../src/db.js';
import { DEMO_MEMBERS, seedDemo } from '../src/seed-demo.js';
import { forgetCustomers, queueReminders, sendOutbox } from '../src/worker.js';

// These tests need Postgres: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/openrelay_test.
// The database is emptied first.
const url = process.env.TEST_DATABASE_URL ?? '';

function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected a ${what}.`);
  return value;
}

describe.skipIf(!url)('API against Postgres', () => {
  let app: FastifyInstance;
  let pool: Pool;
  // A fixed key, so the test can seal a connection secret the way the server opens it.
  const config = {
    ...loadConfig({}),
    databaseUrl: url,
    logLevel: 'silent',
    secretKey: 'test-key-for-openrelay-api-export',
  };
  const as: Record<'root' | keyof typeof DEMO_MEMBERS, string> = {
    root: '',
    admin: '',
    merchant: '',
    courier: '',
    point: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the answer's type
  const call = <T = unknown>(
    who: string | null,
    method: string,
    path: string,
    payload?: unknown,
    headers = {},
  ) =>
    app
      .inject({
        method: method as 'GET',
        url: path,
        payload: payload as object,
        headers: { ...(who ? { cookie: who } : {}), ...headers },
      })
      .then((r) => ({ status: r.statusCode, body: (r.headers['content-type']?.toString().includes('json') ? r.json() : null) as T, raw: r }));

  async function signIn(email: string, password: string): Promise<string> {
    const response = await call(null, 'POST', '/api/session', { email, password });
    expect(response.status).toBe(200);
    const cookie = must(response.raw.cookies.find((c) => c.name === 'or_session'), 'session cookie');
    return `or_session=${cookie.value}`;
  }

  const n = '/api/n/demo';
  const sql = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
    withScope(pool, { bypass: true }, async (db) => (await db.query<T>(text, values)).rows);

  async function newParcel(pointSlug = 'corner-shop'): Promise<ParcelRow> {
    const [point] = await sql<{ id: string }>(
      `SELECT p.id FROM points p JOIN networks n ON n.id = p.network_id
        WHERE n.slug = 'demo' AND p.slug = $1`,
      [pointSlug],
    );
    const created = await call<ParcelRow>(as.merchant, 'POST', `${n}/parcels`, {
      pointId: point.id,
      reference: '#T1',
      customer: { name: 'Test Customer', email: 'Test@Example.com', street: 'X 1', postcode: '2200', city: 'Cph' },
    });
    expect(created.status).toBe(201);
    return created.body;
  }

  const pickupCodeOf = async (id: string) =>
    (await sql<{ c: string }>('SELECT pickup_code AS c FROM parcels WHERE id = $1', [id]))[0].c;

  beforeAll(async () => {
    const owner = new pg.Client({ connectionString: url });
    await owner.connect();
    await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await owner.end();
    await migrate(url, fileURLToPath(new URL('../migrations', import.meta.url)));
    pool = createPool(url);
    app = await buildApp(config, pool);
    await pool.query(
      `INSERT INTO accounts (email, name, password_hash, is_server_admin) VALUES ('root@example.com', 'Root', $1, true)`,
      [await hashPassword('root-password')],
    );
    await seedDemo(pool, config);
    as.root = await signIn('root@example.com', 'root-password');
    for (const role of ['admin', 'merchant', 'courier', 'point'] as const) {
      as[role] = await signIn(DEMO_MEMBERS[role].email, DEMO_MEMBERS[role].password);
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('tells each member their role in the network', async () => {
    const me = await call<Me>(as.merchant, 'GET', '/api/me');
    expect(me.body.networks).toHaveLength(1);
    expect(me.body.networks[0]).toMatchObject({ slug: 'demo', role: 'merchant' });
    expect(me.body.networks[0].merchantId).toBeTypeOf('string');
  });

  it('walks a parcel from the shop to the customer, with an email at each step', async () => {
    const parcel = await newParcel();
    expect(parcel.status).toBe('registered');

    const steps: [string, string][] = [['merchant', 'ready'], ['courier', 'in_transit'], ['point', 'at_point']];
    for (const [who, to] of steps) {
      const result = await call<ScanResult>(as[who as 'merchant'], 'POST', `${n}/scan`, { code: parcel.code });
      expect(result.status, `${who} → ${to}`).toBe(200);
      expect(result.body.to).toBe(to);
    }

    // Handing over needs the customer's code.
    const without = await call<ScanRefused>(as.point, 'POST', `${n}/scan`, { code: parcel.code });
    expect(without.status).toBe(409);
    expect(without.body.needsPickupCode).toBe(true);
    const wrong = await call<ScanRefused>(as.point, 'POST', `${n}/scan`, { code: parcel.code, pickupCode: '000000' });
    expect(wrong.body.error).toMatch(/isn’t right/);
    const right = await call<ScanResult>(as.point, 'POST', `${n}/scan`, {
      code: `https://relay.example/s/${parcel.code.slice(0, 4)}-${parcel.code.slice(4)}`,
      pickupCode: await pickupCodeOf(parcel.id),
    });
    expect(right.status).toBe(200);
    expect(right.body.to).toBe('collected');

    const emails = await sql<{ subject: string; to: string }>(
      'SELECT subject, to_email AS to FROM outbox WHERE parcel_id = $1 ORDER BY created_at',
      [parcel.id],
    );
    expect(emails.map((e) => e.subject)).toEqual([
      'Your order #T1 from Nordic Knits is on its way to Corner Shop',
      'Your order #T1 from Nordic Knits is out for delivery',
      'Your order #T1 from Nordic Knits is ready to collect',
      'Your order #T1 from Nordic Knits was collected',
    ]);
    expect(emails[0].to).toBe('test@example.com');
  });

  it('refuses steps out of order or by the wrong role, and says why', async () => {
    const parcel = await newParcel();
    const courier = await call<ScanRefused>(as.courier, 'POST', `${n}/scan`, { code: parcel.code });
    expect(courier.status).toBe(409);
    expect(courier.body.error).toBe('The shop hasn’t marked this parcel ready yet.');
    const point = await call<ScanRefused>(as.point, 'POST', `${n}/scan`, { code: parcel.code });
    expect(point.status).toBe(409);
    // Point staff don't see parcels that haven't left the shop.
    expect(point.body.parcel).toBeUndefined();
    const bad = await call<ScanRefused>(as.courier, 'POST', `${n}/scan`, { code: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('only lets point staff receive parcels for their own point', async () => {
    const parcel = await newParcel('station-kiosk');
    await call(as.merchant, 'POST', `${n}/scan`, { code: parcel.code });
    await call(as.courier, 'POST', `${n}/scan`, { code: parcel.code });
    const refused = await call<ScanRefused>(as.point, 'POST', `${n}/scan`, { code: parcel.code });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('This parcel goes to Station Kiosk, not here.');
  });

  it('undoes your own last scan within minutes, and drops its unsent email', async () => {
    const parcel = await newParcel();
    await call(as.merchant, 'POST', `${n}/scan`, { code: parcel.code });
    const pickedUp = await call<ScanResult>(as.courier, 'POST', `${n}/scan`, { code: parcel.code });
    const someoneElse = await call(as.merchant, 'POST', `${n}/scans/${pickedUp.body.scanId}/undo`);
    expect(someoneElse.status).toBe(409);
    const undone = await call<ParcelRow>(as.courier, 'POST', `${n}/scans/${pickedUp.body.scanId}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.status).toBe('ready');
    const out = await sql('SELECT 1 FROM outbox WHERE scan_id = $1', [pickedUp.body.scanId]);
    expect(out).toHaveLength(0);
    const again = await call(as.courier, 'POST', `${n}/scans/${pickedUp.body.scanId}/undo`);
    expect(again.status).toBe(409);
  });

  it('cancels a parcel until a courier has it', async () => {
    const parcel = await newParcel();
    const cancelled = await call<ParcelRow>(as.merchant, 'POST', `${n}/parcels/${parcel.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
    const later = await newParcel();
    await call(as.merchant, 'POST', `${n}/scan`, { code: later.code });
    await call(as.courier, 'POST', `${n}/scan`, { code: later.code });
    const refused = await call(as.merchant, 'POST', `${n}/parcels/${later.id}/cancel`);
    expect(refused.status).toBe(409);
  });

  it('shows each role only its own parcels, and couriers no customer details', async () => {
    const shop = await call<ParcelsPage>(as.merchant, 'GET', `${n}/parcels`);
    expect(shop.body.parcels.every((p) => p.merchant.name === 'Nordic Knits')).toBe(true);
    const all = await call<ParcelsPage>(as.admin, 'GET', `${n}/parcels`);
    expect(all.body.total).toBeGreaterThan(shop.body.total);
    const point = await call<ParcelsPage>(as.point, 'GET', `${n}/parcels`);
    expect(point.body.parcels.every((p) => p.point.name === 'Corner Shop' && p.status !== 'registered')).toBe(true);

    const other = must(all.body.parcels.find((p) => p.merchant.name === 'Bean & Leaf Coffee'));
    expect((await call(as.merchant, 'GET', `${n}/parcels/${other.id}`)).status).toBe(404);
    const courierView = await call<Parcel>(as.courier, 'GET', `${n}/parcels/${other.id}`);
    expect(courierView.body.customer).toBeNull();
    expect(courierView.body.trackingUrl).toBeNull();
    const adminView = await call<Parcel>(as.admin, 'GET', `${n}/parcels/${other.id}`);
    expect(adminView.body.customer?.name).toBe('Liam Dahl');
    expect(JSON.stringify(adminView.body)).not.toMatch(/pickup/i);

    const search = await call<ParcelsPage>(as.admin, 'GET', `${n}/parcels?q=liam`);
    expect(search.body.parcels.map((p) => p.id)).toEqual([other.id]);
  });

  it('lists ready parcels for the courier, by shop', async () => {
    const stops = await call<PickupStop[]>(as.courier, 'GET', `${n}/pickups`);
    expect(stops.body.length).toBeGreaterThan(0);
    expect(stops.body[0].merchant.name).toBe('Nordic Knits');
    expect((await call(as.merchant, 'GET', `${n}/pickups`)).status).toBe(403);
  });

  it('suggests the nearest points by postcode', async () => {
    const points = await call<SuggestedPoint[]>(as.merchant, 'GET', `${n}/points/suggest?postcode=1651&city=Copenhagen`);
    expect(points.body[0].name).toBe('Station Kiosk');
  });

  it('prints labels with a QR code that opens the scan page', async () => {
    const parcel = await newParcel();
    const page = await call(as.merchant, 'GET', `${n}/labels?ids=${parcel.id}`);
    expect(page.raw.headers['content-type']).toMatch(/text\/html/);
    expect(page.raw.body).toContain('<svg');
    expect(page.raw.body).toContain(`${parcel.code.slice(0, 4)}-${parcel.code.slice(4)}`);
    expect((await call(as.courier, 'GET', `${n}/labels?ids=${parcel.id}`)).status).toBe(403);
  });

  it('imports parcels from CSV and lists the rows it couldn’t add', async () => {
    const csv = 'name;email;postcode;city;reference;point\n' +
      'Ann;ann@example.com;2200;Copenhagen;C1;\n' +
      'Bo;not-an-email;2200;Copenhagen;C2;\n' +
      'Cy;cy@example.com;1650;Copenhagen;C3;Nowhere\n';
    const result = await call<{ created: number; errors: { row: number }[] }>(
      as.merchant, 'POST', `${n}/parcels/import`, { csv },
    );
    expect(result.body.created).toBe(1);
    expect(result.body.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it('shows the customer a tracking page, with the pickup code only at the point', async () => {
    const parcel = await newParcel();
    const detail = await call<Parcel>(as.merchant, 'GET', `${n}/parcels/${parcel.id}`);
    const token = must(detail.body.trackingUrl).split('/t/')[1];
    const before = await call<Tracking>(null, 'GET', `/api/track/${token}`);
    expect(before.body.status).toBe('registered');
    expect(before.body.pickupCode).toBeNull();
    for (const who of ['merchant', 'courier', 'point'] as const) {
      await call(as[who], 'POST', `${n}/scan`, { code: parcel.code });
    }
    const at = await call<Tracking>(null, 'GET', `/api/track/${token}`);
    expect(at.body.pickupCode).toBe(await pickupCodeOf(parcel.id));
    expect(at.body.steps.map((s) => s.status)).toEqual(['registered', 'ready', 'in_transit', 'at_point']);
    expect(at.raw.headers['cache-control']).toBe('no-store');
    expect((await call(null, 'GET', '/api/track/not-a-real-token-at-all')).status).toBe(404);
  });

  it('lets a shop add and read its parcels with an API key, and nothing else', async () => {
    const merchants = await call<{ id: string; slug: string }[]>(as.admin, 'GET', `${n}/merchants`);
    const bean = must(merchants.body.find((m) => m.slug === 'bean-and-leaf'));
    const key = await call<NewApiKey>(as.admin, 'POST', `${n}/api-keys`, { name: 'Webshop', merchantId: bean.id });
    expect(key.body.key).toMatch(/^rk_/);
    const auth = { authorization: `Bearer ${key.body.key}` };

    const points = await call<SuggestedPoint[]>(null, 'GET', '/api/v1/points?postcode=2200', undefined, auth);
    const created = await call<Parcel>(null, 'POST', '/api/v1/parcels', {
      pointId: points.body[0].id,
      reference: 'API-1',
      customer: { name: 'Api Customer', email: 'api@example.com' },
    }, auth);
    expect(created.status).toBe(201);
    expect(created.body.merchant.name).toBe('Bean & Leaf Coffee');
    expect(created.body.trackingUrl).toMatch(/\/t\//);

    const own = await call<Parcel>(null, 'GET', `/api/v1/parcels/${created.body.code}`, undefined, auth);
    expect(own.status).toBe(200);
    const nordic = (await call<ParcelsPage>(as.merchant, 'GET', `${n}/parcels`)).body.parcels[0];
    const foreign = await call(null, 'GET', `/api/v1/parcels/${nordic.code}`, undefined, auth);
    expect(foreign.status).toBe(404);
    expect((await call(null, 'GET', '/api/v1/points', undefined, { authorization: 'Bearer rk_wrongwrongwrongwrongwrong' })).status).toBe(401);
  });

  it('keeps networks apart', async () => {
    const other = await call<{ slug: string }>(as.root, 'POST', '/api/networks', { name: 'Other Network' });
    expect(other.status).toBe(201);
    expect((await call(as.admin, 'GET', '/api/n/other-network/parcels')).status).toBe(404);
    const rootView = await call<ParcelsPage>(as.root, 'GET', '/api/n/other-network/parcels');
    expect(rootView.body.total).toBe(0);
    // A code from the demo network isn't found from the other one.
    const demoParcel = (await call<ParcelsPage>(as.admin, 'GET', `${n}/parcels`)).body.parcels[0];
    const scanned = await call(as.root, 'POST', '/api/n/other-network/scan', { code: demoParcel.code });
    expect(scanned.status).toBe(404);
    // Row-level security, even with a query that forgets its WHERE clause.
    const seen = await withScope(pool, { networkId: (await sql<{ id: string }>(
      "SELECT id FROM networks WHERE slug = 'other-network'"))[0].id }, async (db) =>
      (await db.query('SELECT * FROM parcels')).rowCount);
    expect(seen).toBe(0);
  });

  it('never lets someone change their own role or remove themselves', async () => {
    const me = await call<Me>(as.admin, 'GET', '/api/me');
    const self = await call(as.admin, 'PATCH', `${n}/members/${me.body.id}`, { role: 'courier' });
    expect(self.status).toBe(403);
    expect((await call(as.admin, 'DELETE', `${n}/members/${me.body.id}`)).status).toBe(403);
    const courier = await call<Me>(as.courier, 'GET', '/api/me');
    const raise = await call(as.courier, 'PATCH', `${n}/members/${courier.body.id}`, { role: 'admin' });
    expect(raise.status).toBe(403);
    const pointStaff = await call(as.admin, 'POST', `${n}/members`, { email: 'new@example.com', role: 'point' });
    expect(pointStaff.status).toBe(400);
  });

  it('sends the outbox, reminds customers and forgets them after the retention period', async () => {
    const sent: string[] = [];
    const mailer = {
      send: (m: { subject: string }) => {
        sent.push(m.subject);
        return Promise.resolve();
      },
    };
    const count = await sendOutbox(pool, mailer, 500);
    expect(count).toBe(sent.length);
    expect(count).toBeGreaterThan(0);

    const parcel = await newParcel();
    for (const who of ['merchant', 'courier', 'point'] as const) {
      await call(as[who], 'POST', `${n}/scan`, { code: parcel.code });
    }
    await sql("UPDATE parcels SET hold_until = now() + interval '1 day' WHERE id = $1", [parcel.id]);
    expect(await queueReminders(pool, config)).toBeGreaterThanOrEqual(1);
    expect(await queueReminders(pool, config)).toBe(0);
    const [reminder] = await sql<{ subject: string }>(
      "SELECT subject FROM outbox WHERE parcel_id = $1 AND subject LIKE 'Collect your parcel%'",
      [parcel.id],
    );
    expect(reminder).toBeDefined();

    await sql(
      "UPDATE parcels SET status = 'collected', closed_at = now() - interval '100 days' WHERE id = $1",
      [parcel.id],
    );
    expect(await forgetCustomers(pool, config)).toBeGreaterThanOrEqual(1);
    const detail = await call<Parcel>(as.admin, 'GET', `${n}/parcels/${parcel.id}`);
    expect(detail.body.customer).toBeNull();
    expect(detail.body.scans.length).toBeGreaterThan(0);
  });

  it('exports a network and imports it into another', async () => {
    const exported = await call<NetworkExport>(as.admin, 'GET', `${n}/export`);
    expect(exported.body.format).toBe('openrelay-export');
    expect(exported.body.points.map((p: Point | NetworkExport['points'][number]) => p.slug)).toContain('corner-shop');
    await call(as.root, 'POST', '/api/networks', { name: 'Copy' });
    const imported = await call<{ parcels: number; skipped: number }>(as.root, 'POST', '/api/n/copy/import', exported.body);
    expect(imported.status).toBe(200);
    // Parcel codes are unique on the server, so the same parcels are skipped here.
    expect(imported.body.parcels).toBe(0);
    expect(imported.body.skipped).toBe(exported.body.parcels.length);
    const points = await call<Point[]>(as.root, 'GET', '/api/n/copy/points');
    expect(points.body).toHaveLength(3);
  });

  it('UC-5/S6 keeps a saved signing secret out of the admin list and an export', async () => {
    const secret = 'sig_relay_saved_secret_51c8e0';
    const sealed = vaultFor(config.secretKey).seal(secret);
    await pool.query(
      `INSERT INTO server_integrations (kind, url, public_key, signing_secret_encrypted)
       VALUES ('openannounce', 'https://news.example.com', 'pk_news_saved_12345678', $1)
       ON CONFLICT (kind) DO UPDATE SET signing_secret_encrypted = EXCLUDED.signing_secret_encrypted`,
      [sealed],
    );
    try {
      const list = await call(as.root, 'GET', '/api/admin/integrations');
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).toContain('pk_news_saved_12345678');
      expect(JSON.stringify(list.body)).not.toContain(secret);

      const exported = await call(as.admin, 'GET', `${n}/export`);
      expect(exported.status).toBe(200);
      expect(JSON.stringify(exported.body)).not.toContain(secret);
      expect(JSON.stringify(exported.body)).not.toContain('signing_secret');
    } finally {
      await pool.query("DELETE FROM server_integrations WHERE kind = 'openannounce'");
    }
  });

  it('UC-7/S1 S2 S7 signs an opaque id and the groups for the network, never a name or email', async () => {
    const secret = 'sig_relay_token_secret_7a1f20';
    await pool.query(
      `INSERT INTO server_integrations (kind, url, public_key, signing_secret_encrypted)
       VALUES ('openannounce', 'https://news.example.com', 'pk_news_token_12345678', $1)
       ON CONFLICT (kind) DO UPDATE SET signing_secret_encrypted = EXCLUDED.signing_secret_encrypted`,
      [vaultFor(config.secretKey).seal(secret)],
    );
    try {
      const token = await call(as.courier, 'GET', '/api/openannounce-token?network=demo');
      expect(token.status).toBe(200);
      const verified = await verifyUser(secret, token.raw.body);
      if (!verified.ok) throw new Error(verified.error);
      expect(verified.claims.groups).toEqual(['t-demo', 'role-courier', 't-demo-role-courier']);
      const me = await call<Me>(as.courier, 'GET', '/api/me');
      expect(verified.claims.sub).toBe(me.body.id);
      expect(token.raw.body).not.toContain(DEMO_MEMBERS.courier.email);
      expect(JSON.stringify(verified.claims)).not.toContain(me.body.name);

      const noNetwork = await call(as.courier, 'GET', '/api/openannounce-token');
      const plain = await verifyUser(secret, noNetwork.raw.body);
      expect(plain.ok && plain.claims.groups).toEqual([]);

      const elsewhere = await call(as.courier, 'GET', '/api/openannounce-token?network=nowhere');
      expect(elsewhere.status).toBe(404);
      expect((await call(null, 'GET', '/api/openannounce-token')).status).toBe(401);
    } finally {
      await pool.query("DELETE FROM server_integrations WHERE kind = 'openannounce'");
    }
  });

  it('UC-6/S6 gives no OpenAnnounce token once the connection is removed', async () => {
    const response = await call(as.courier, 'GET', '/api/openannounce-token?network=demo');
    expect(response.status).toBe(204);
  });

  it('UC-5/S6 keeps a saved deploy token out of the admin list and an export', async () => {
    const token = 'ov_relay_saved_deploy_token_8f2a';
    const sealed = vaultFor(config.secretKey).seal(token);
    await pool.query(
      `INSERT INTO server_integrations (kind, url, public_key, deploy_token_encrypted)
       VALUES ('openversion', 'https://versions.example.com', 'pk_versions_12345678', $1)
       ON CONFLICT (kind) DO UPDATE SET deploy_token_encrypted = EXCLUDED.deploy_token_encrypted`,
      [sealed],
    );
    try {
      const list = await call(as.root, 'GET', '/api/admin/integrations');
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).toContain('"hasDeployToken":true');
      expect(JSON.stringify(list.body)).not.toContain(token);

      const exported = await call(as.admin, 'GET', `${n}/export`);
      expect(exported.status).toBe(200);
      expect(JSON.stringify(exported.body)).not.toContain(token);
      expect(JSON.stringify(exported.body)).not.toContain('deploy_token');
    } finally {
      await pool.query("DELETE FROM server_integrations WHERE kind = 'openversion'");
    }
  });

  it('makes a scan in a few round trips: session, access, then one transaction', async () => {
    const parcel = await newParcel();
    const spy = vi.spyOn(pg.Client.prototype, 'query');
    const result = await call(as.merchant, 'POST', `${n}/scan`, { code: parcel.code });
    const trips = spy.mock.calls.length;
    spy.mockRestore();
    expect(result.status).toBe(200);
    // Session, access, BEGIN + scope, load, step, COMMIT.
    expect(trips).toBeLessThanOrEqual(6);
  });

  it('refuses changes posted from another site', async () => {
    const response = await call(as.admin, 'POST', `${n}/scan`, { code: 'X' }, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
  });
});
