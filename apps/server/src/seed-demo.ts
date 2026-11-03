import { fileURLToPath } from 'node:url';
import type { OpeningHours, Role } from '@open-relay/contracts';
import { hashPassword } from './auth.js';
import { type Config, loadConfig } from './config.js';
import { createPool, migrate, type Pool, withScope } from './db.js';
import { type Actor, createParcel, scan } from './parcels.js';

/** The demo's people. Their passwords are for trying OpenRelay out, never for a real server. */
export const DEMO_MEMBERS = {
  admin: { email: 'admin@demo.openrelay.dev', password: 'demo-admin-pass', name: 'Ada Admin' },
  merchant: { email: 'shop@demo.openrelay.dev', password: 'demo-shop-pass', name: 'Sam Shop' },
  courier: { email: 'courier@demo.openrelay.dev', password: 'demo-courier-pass', name: 'Cleo Courier' },
  point: { email: 'point@demo.openrelay.dev', password: 'demo-point-pass', name: 'Per Point' },
} satisfies Record<Role, { email: string; password: string; name: string }>;

const WEEK: OpeningHours = ['8–20', '8–20', '8–20', '8–20', '8–20', '9–18', '10–16'];

/**
 * A demo network: two shops, three pick-up points, one member per role and parcels at every
 * step, made through the same code the API uses. Running it again changes nothing.
 */
export async function seedDemo(pool: Pool, config: Config = loadConfig()): Promise<boolean> {
  const existing = await pool.query("SELECT 1 FROM networks WHERE slug = 'demo'");
  if (existing.rowCount) return false;
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO networks (slug, name) VALUES ('demo', 'Demo Network') RETURNING id",
  );
  const networkId = rows[0].id;

  return withScope(pool, { networkId }, async (db) => {
    const merchants = await db.query<{ id: string; slug: string }>(
      `INSERT INTO merchants (network_id, slug, name, address, email) VALUES
         ($1, 'nordic-knits', 'Nordic Knits', 'Vestergade 12, 1456 Copenhagen', 'hello@nordic-knits.example'),
         ($1, 'bean-and-leaf', 'Bean & Leaf Coffee', 'Jægersborggade 3, 2200 Copenhagen', null)
       RETURNING id, slug`,
      [networkId],
    );
    const points = await db.query<{ id: string; slug: string }>(
      `INSERT INTO points (network_id, slug, name, street, postcode, city, lat, lng, opening_hours) VALUES
         ($1, 'corner-shop', 'Corner Shop', 'Nørrebrogade 40', '2200', 'Copenhagen', 55.6893, 12.5528, $2),
         ($1, 'station-kiosk', 'Station Kiosk', 'Istedgade 2', '1650', 'Copenhagen', 55.6717, 12.5627, $2),
         ($1, 'harbour-books', 'Harbour Books', 'Havnegade 21', '1058', 'Copenhagen', 55.6762, 12.5900, $3)
       RETURNING id, slug`,
      [networkId, WEEK, ['10–18', '10–18', '10–18', '10–18', '10–18', '10–14', 'closed']],
    );
    const merchant = (slug: string) => merchants.rows.find((m) => m.slug === slug)?.id ?? '';
    const point = (slug: string) => points.rows.find((p) => p.slug === slug)?.id ?? '';

    const accounts: Record<Role, string> = { admin: '', merchant: '', courier: '', point: '' };
    for (const [role, m] of Object.entries(DEMO_MEMBERS) as [Role, (typeof DEMO_MEMBERS)[Role]][]) {
      const { rows: created } = await db.query<{ id: string }>(
        `INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [m.email, m.name, await hashPassword(m.password)],
      );
      accounts[role] = created[0].id;
      await db.query(
        `INSERT INTO memberships (network_id, account_id, role, merchant_id, point_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          networkId,
          created[0].id,
          role,
          role === 'merchant' ? merchant('nordic-knits') : null,
          role === 'point' ? point('corner-shop') : null,
        ],
      );
    }
    const actor = (role: Role): Actor => ({
      role,
      accountId: accounts[role],
      name: DEMO_MEMBERS[role].name,
      merchantId: role === 'merchant' ? merchant('nordic-knits') : null,
      pointId: role === 'point' ? point('corner-shop') : null,
    });

    const customers = [
      ['Mia Jensen', 'Nørrebrogade 52', 'registered', '#1041'],
      ['Noah Larsen', 'Fælledvej 8', 'ready', '#1042'],
      ['Ella Holm', 'Stefansgade 19', 'in_transit', '#1043'],
      ['Oscar Berg', 'Blågårdsgade 7', 'at_point', '#1044'],
      ['Freja Lund', 'Ravnsborggade 11', 'collected', '#1045'],
    ] as const;
    const steps = ['registered', 'ready', 'in_transit', 'at_point', 'collected'] as const;
    const by: Role[] = ['merchant', 'courier', 'point', 'point'];
    for (const [name, street, upTo, reference] of customers) {
      const parcel = await createParcel(
        db,
        networkId,
        {
          merchantId: merchant('nordic-knits'),
          pointId: point('corner-shop'),
          reference,
          customer: {
            name,
            email: `${name.split(' ')[0].toLowerCase()}@example.com`,
            phone: null,
            street,
            postcode: '2200',
            city: 'Copenhagen',
          },
        },
        actor('merchant'),
        config,
      );
      for (let i = 0; i < steps.indexOf(upTo); i++) {
        const pickup = by[i] === 'point' && i === 3
          ? (await db.query<{ c: string }>('SELECT pickup_code AS c FROM parcels WHERE id = $1', [parcel.id]))
              .rows[0].c
          : undefined;
        await scan(db, networkId, parcel.code, pickup, actor(by[i]), config);
      }
    }
    // One from the other shop, so lists and filters have something to tell apart.
    await createParcel(
      db,
      networkId,
      {
        merchantId: merchant('bean-and-leaf'),
        pointId: point('station-kiosk'),
        reference: 'BL-77',
        customer: {
          name: 'Liam Dahl',
          email: 'liam@example.com',
          phone: '+45 20 30 40 50',
          street: 'Istedgade 90',
          postcode: '1650',
          city: 'Copenhagen',
        },
      },
      { ...actor('admin'), merchantId: null },
      config,
    );
    return true;
  });
}

// `node dist/seed-demo.js`: migrates, seeds and stops.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  await migrate(config.databaseUrl, fileURLToPath(new URL('../migrations', import.meta.url)));
  const pool = createPool(config.databaseUrl);
  const made = await seedDemo(pool, config);
  console.log(
    made
      ? `Seeded the demo network. Sign in as ${Object.values(DEMO_MEMBERS)
        .map((m) => `${m.email} / ${m.password}`)
        .join(', ')}.`
      : 'The demo network is there already.',
  );
  await pool.end();
}
