import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Merchant, OpeningHours, Point, SuggestedPoint } from '@open-relay/contracts';
import { networkAccess } from '../auth.js';
import type { Config } from '../config.js';
import { type Pool, withScope } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { geocode, suggestPoints } from '../points.js';
import { idParam, name, networkParam, slugify } from './shared.js';

const ALL = ['admin', 'merchant', 'courier', 'point'] as const;

export const merchantInput = z.object({
  name,
  address: z.string().trim().max(300).default(''),
  email: z.email().max(200).nullish(),
});

const hours = z.string().trim().max(40);
export const pointInput = z.object({
  name,
  street: z.string().trim().min(1, 'Add the street.').max(200),
  postcode: z.string().trim().min(1, 'Add the postcode.').max(20),
  city: z.string().trim().min(1, 'Add the city.').max(100),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  openingHours: z.tuple([hours, hours, hours, hours, hours, hours, hours]),
  active: z.boolean().default(true),
});

const MERCHANT = `id, slug, name, address, email,
  (SELECT count(*)::int FROM parcels p WHERE p.merchant_id = merchants.id
     AND p.status NOT IN ('collected', 'cancelled')) AS "parcelCount"`;
const POINT = `id, slug, name, street, postcode, city, lat, lng, opening_hours AS "openingHours", active,
  (SELECT count(*)::int FROM parcels p WHERE p.point_id = points.id AND p.status = 'at_point') AS waiting`;

/** Merchants and pick-up points: admins manage them, every member reads them. */
export function registerPlaceRoutes(app: FastifyInstance, pool: Pool, config: Config): void {
  app.get('/api/n/:network/merchants', async (request): Promise<Merchant[]> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ALL);
    return withScope(pool, { networkId }, async (db) =>
      (await db.query<Merchant>(`SELECT ${MERCHANT} FROM merchants ORDER BY name`)).rows,
    );
  });

  app.post('/api/n/:network/merchants', async (request, reply): Promise<Merchant> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const body = merchantInput.parse(request.body);
    const merchant = await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<Merchant>(
        `INSERT INTO merchants (network_id, slug, name, address, email)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${MERCHANT}`,
        [networkId, slugify(body.name), body.name, body.address, body.email ?? null],
      );
      return rows[0];
    });
    void reply.code(201);
    return merchant;
  });

  app.patch('/api/n/:network/merchants/:id', async (request): Promise<Merchant> => {
    const { network, id } = idParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const body = merchantInput.parse(request.body);
    const merchant = await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<Merchant>(
        `UPDATE merchants SET name = $2, address = $3, email = $4 WHERE id = $1 RETURNING ${MERCHANT}`,
        [id, body.name, body.address, body.email ?? null],
      );
      return rows.at(0);
    });
    if (!merchant) throw notFound('That shop');
    return merchant;
  });

  app.delete('/api/n/:network/merchants/:id', async (request): Promise<{ ok: true }> => {
    const { network, id } = idParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM parcels WHERE merchant_id = $1',
        [id],
      );
      if (rows[0].n > 0) {
        throw new HttpError(409, 'This shop has parcels, so it can’t be deleted.');
      }
      await db.query('DELETE FROM merchants WHERE id = $1', [id]);
    });
    return { ok: true };
  });

  // Pick-up points -------------------------------------------------------------------------

  app.get('/api/n/:network/points', async (request): Promise<Point[]> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ALL);
    return withScope(pool, { networkId }, async (db) =>
      (await db.query<Point>(`SELECT ${POINT} FROM points ORDER BY name`)).rows,
    );
  });

  /** The points nearest a customer's address, for the new parcel form. */
  app.get('/api/n/:network/points/suggest', async (request): Promise<SuggestedPoint[]> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin', 'merchant']);
    const address = addressQuery.parse(request.query);
    return withScope(pool, { networkId }, (db) => suggestPoints(db, config, address));
  });

  type PointBody = z.infer<typeof pointInput>;
  const savePoint = async (networkId: string, id: string | null, body: PointBody) => {
    // Without coordinates, ask the geocoder (if there is one), so points can be sorted by distance.
    const coords =
      body.lat !== null && body.lat !== undefined && body.lng !== null && body.lng !== undefined
        ? { lat: body.lat, lng: body.lng }
        : await geocode(config, body);
    const values = [
      body.name,
      body.street,
      body.postcode,
      body.city,
      coords?.lat ?? null,
      coords?.lng ?? null,
      body.openingHours satisfies OpeningHours,
      body.active,
    ];
    return withScope(pool, { networkId }, async (db) => {
      const { rows } = id
        ? await db.query<Point>(
            `UPDATE points SET name = $2, street = $3, postcode = $4, city = $5, lat = $6, lng = $7,
             opening_hours = $8, active = $9 WHERE id = $1 RETURNING ${POINT}`,
            [id, ...values],
          )
        : await db.query<Point>(
            `INSERT INTO points (network_id, slug, name, street, postcode, city, lat, lng,
             opening_hours, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${POINT}`,
            [networkId, slugify(body.name), ...values],
          );
      return rows.at(0);
    });
  };

  app.post('/api/n/:network/points', async (request, reply): Promise<Point> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const point = await savePoint(networkId, null, pointInput.parse(request.body));
    void reply.code(201);
    if (!point) throw new HttpError(500, 'The point wasn’t saved.');
    return point;
  });

  app.patch('/api/n/:network/points/:id', async (request): Promise<Point> => {
    const { network, id } = idParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const point = await savePoint(networkId, id, pointInput.parse(request.body));
    if (!point) throw notFound('That pick-up point');
    return point;
  });

  app.delete('/api/n/:network/points/:id', async (request): Promise<{ ok: true }> => {
    const { network, id } = idParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM parcels WHERE point_id = $1',
        [id],
      );
      if (rows[0].n > 0) {
        throw new HttpError(409, 'Parcels went to this point, so it can’t be deleted. Close it instead.');
      }
      await db.query('DELETE FROM points WHERE id = $1', [id]);
    });
    return { ok: true };
  });
}

export const addressQuery = z.object({
  street: z.string().max(200).optional(),
  postcode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
});
