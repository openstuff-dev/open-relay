import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type NetworkExport, STATUSES } from '@open-relay/contracts';
import { networkAccess } from '../auth.js';
import { type Pool, withScope } from '../db.js';
import { merchantInput, pointInput } from './places.js';
import { customerInput } from './parcels.js';
import { networkParam, newPickupCode, newTrackingToken, slug } from './shared.js';

const status = z.enum(STATUSES);
const importFile = z.object({
  format: z.literal('openrelay-export'),
  version: z.literal(1),
  merchants: z.array(merchantInput.extend({ slug })).max(10_000),
  points: z.array(pointInput.extend({ slug })).max(10_000),
  parcels: z
    .array(
      z.object({
        code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
        merchant: slug,
        point: slug,
        reference: z.string().max(100).nullable(),
        status,
        customer: customerInput.nullable(),
        holdUntil: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
        scans: z.array(
          z.object({
            from: status.nullable(),
            to: status,
            role: z.string().max(20),
            by: z.string().max(200),
            at: z.string(),
          }),
        ),
      }),
    )
    .max(200_000),
});

/** Everything a network holds, as one JSON file, and back. People own their data. */
export function registerTransferRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/n/:network/export', async (request, reply): Promise<NetworkExport> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const data = await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<{ data: NetworkExport }>(
        `SELECT json_build_object(
          'format', 'openrelay-export', 'version', 1, 'exportedAt', now(),
          'network', (SELECT json_build_object('slug', slug, 'name', name) FROM networks WHERE id = $1),
          'merchants', coalesce((SELECT json_agg(json_build_object('slug', slug, 'name', name,
             'address', address, 'email', email) ORDER BY slug) FROM merchants), '[]'),
          'points', coalesce((SELECT json_agg(json_build_object('slug', slug, 'name', name,
             'street', street, 'postcode', postcode, 'city', city, 'lat', lat, 'lng', lng,
             'openingHours', opening_hours, 'active', active) ORDER BY slug) FROM points), '[]'),
          'parcels', coalesce((SELECT json_agg(json_build_object('code', p.code, 'merchant', m.slug,
             'point', pt.slug, 'reference', p.reference, 'status', p.status,
             'customer', CASE WHEN p.customer_name IS NULL THEN null ELSE json_build_object(
               'name', p.customer_name, 'email', p.customer_email, 'phone', p.customer_phone,
               'street', p.customer_street, 'postcode', p.customer_postcode, 'city', p.customer_city) END,
             'holdUntil', p.hold_until, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
             'scans', coalesce((SELECT json_agg(json_build_object('from', s.from_status, 'to', s.to_status,
               'role', s.role, 'by', s.by_name, 'at', s.at) ORDER BY s.at) FROM scans s
               WHERE s.parcel_id = p.id AND s.undone_at IS NULL), '[]'))
             ORDER BY p.created_at)
             FROM parcels p JOIN merchants m ON m.id = p.merchant_id JOIN points pt ON pt.id = p.point_id),
             '[]')
        ) AS data`,
        [networkId],
      );
      return rows[0].data;
    });
    void reply.header('Content-Disposition', `attachment; filename="openrelay-${network}.json"`);
    return data;
  });

  /**
   * Adds what's in an export to this network. Shops and points with a slug it already has are
   * updated. Parcels whose code is already on this server are skipped; the others get new
   * tracking links and pickup codes, and no emails are sent.
   */
  app.post('/api/n/:network/import', { bodyLimit: 50 * 1024 * 1024 }, async (request) => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const file = importFile.parse(request.body);
    return withScope(pool, { networkId }, async (db) => {
      await db.query(
        `INSERT INTO merchants (network_id, slug, name, address, email)
         SELECT $1, slug, name, address, email
           FROM json_to_recordset($2::json) AS x(slug text, name text, address text, email text)
         ON CONFLICT (network_id, slug) DO UPDATE
           SET name = EXCLUDED.name, address = EXCLUDED.address, email = EXCLUDED.email`,
        [networkId, JSON.stringify(file.merchants)],
      );
      await db.query(
        `INSERT INTO points (network_id, slug, name, street, postcode, city, lat, lng, opening_hours, active)
         SELECT $1, slug, name, street, postcode, city, lat, lng,
                ARRAY(SELECT json_array_elements_text("openingHours")), active
           FROM json_to_recordset($2::json) AS x(slug text, name text, street text, postcode text,
             city text, lat float8, lng float8, "openingHours" json, active boolean)
         ON CONFLICT (network_id, slug) DO UPDATE SET name = EXCLUDED.name, street = EXCLUDED.street,
           postcode = EXCLUDED.postcode, city = EXCLUDED.city, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           opening_hours = EXCLUDED.opening_hours, active = EXCLUDED.active`,
        [networkId, JSON.stringify(file.points)],
      );
      const parcels = file.parcels.map((p) => ({
        ...p,
        token: newTrackingToken(),
        pickupCode: newPickupCode(),
        customer: p.customer ?? {},
      }));
      const { rows } = await db.query<{ n: number }>(
        `WITH data AS (
           SELECT * FROM json_to_recordset($2::json) AS x(code text, merchant text, point text,
             reference text, status parcel_status, customer json, "holdUntil" timestamptz,
             "createdAt" timestamptz, "updatedAt" timestamptz, scans json, token text, "pickupCode" text)),
         p AS (
           INSERT INTO parcels (network_id, merchant_id, point_id, code, tracking_token, pickup_code,
             reference, status, customer_name, customer_email, customer_phone, customer_street,
             customer_postcode, customer_city, hold_until, closed_at, created_at, updated_at)
           SELECT $1, m.id, pt.id, d.code, d.token, d."pickupCode", d.reference, d.status,
             d.customer->>'name', d.customer->>'email', d.customer->>'phone', d.customer->>'street',
             d.customer->>'postcode', d.customer->>'city', d."holdUntil",
             CASE WHEN d.status IN ('collected', 'cancelled') THEN d."updatedAt" END,
             d."createdAt", d."updatedAt"
             FROM data d JOIN merchants m ON m.slug = d.merchant JOIN points pt ON pt.slug = d.point
           ON CONFLICT (code) DO NOTHING
           RETURNING id, code),
         s AS (
           INSERT INTO scans (network_id, parcel_id, from_status, to_status, role, by_name, at)
           SELECT $1, p.id, (s->>'from')::parcel_status, (s->>'to')::parcel_status, s->>'role',
                  s->>'by', (s->>'at')::timestamptz
             FROM p JOIN data d ON d.code = p.code, json_array_elements(d.scans) s)
         SELECT count(*)::int AS n FROM p`,
        [networkId, JSON.stringify(parcels)],
      );
      return {
        merchants: file.merchants.length,
        points: file.points.length,
        parcels: rows[0].n,
        skipped: file.parcels.length - rows[0].n,
      };
    });
  });
}
