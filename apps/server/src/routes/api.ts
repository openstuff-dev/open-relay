import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiKey, NewApiKey, Parcel, SuggestedPoint, Tracking } from '@open-relay/contracts';
import { networkAccess } from '../auth.js';
import type { Config } from '../config.js';
import { type Pool, withScope } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { type Actor, createParcel, parcelDetail } from '../parcels.js';
import { suggestPoints } from '../points.js';
import { normaliseCode } from '@open-relay/contracts';
import { addressQuery } from './places.js';
import { customerInput } from './parcels.js';
import { idParam, name, networkParam, newApiKey, sha256, uuid } from './shared.js';

const KEY = `k.id, k.name, k.merchant_id AS "merchantId", m.name AS "merchantName", k.hint,
  k.last_used_at AS "lastUsedAt", k.created_at AS "createdAt"`;

/** API keys, the merchant API (/api/v1) and the customer's tracking page. */
export function registerApiRoutes(app: FastifyInstance, pool: Pool, config: Config): void {
  // Keys, managed by admins ------------------------------------------------------------------

  app.get('/api/n/:network/api-keys', async (request): Promise<ApiKey[]> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    return withScope(pool, { networkId }, async (db) =>
      (await db.query<ApiKey>(
        `SELECT ${KEY} FROM api_keys k JOIN merchants m ON m.id = k.merchant_id ORDER BY m.name, k.name`,
      )).rows,
    );
  });

  /** Makes a key for one shop. It's shown this once; only its hash is kept. */
  app.post('/api/n/:network/api-keys', async (request, reply): Promise<NewApiKey> => {
    const { network } = networkParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    const body = z.object({ name, merchantId: uuid }).parse(request.body);
    const key = newApiKey();
    const created = await withScope(pool, { networkId }, async (db) => {
      const { rows } = await db.query<ApiKey>(
        `WITH k AS (
           INSERT INTO api_keys (network_id, merchant_id, name, key_hash, hint)
           SELECT $1, id, $3, $4, $5 FROM merchants WHERE id = $2
           RETURNING *)
         SELECT ${KEY} FROM k JOIN merchants m ON m.id = k.merchant_id`,
        [networkId, body.merchantId, body.name, sha256(key), key.slice(0, 7)],
      );
      return rows.at(0);
    });
    if (!created) throw notFound('That shop');
    void reply.code(201);
    return { ...created, key };
  });

  app.delete('/api/n/:network/api-keys/:id', async (request): Promise<{ ok: true }> => {
    const { network, id } = idParam.parse(request.params);
    const { networkId } = await networkAccess(pool, request, network, ['admin']);
    await withScope(pool, { networkId }, (db) => db.query('DELETE FROM api_keys WHERE id = $1', [id]));
    return { ok: true };
  });

  // The merchant API ------------------------------------------------------------------------

  /** The shop behind an `Authorization: Bearer rk_…` key, or a 401. */
  interface KeyActor { networkId: string; actor: Actor }
  const keyActor = async (request: FastifyRequest): Promise<KeyActor> => {
    const header = request.headers.authorization ?? '';
    const key = /^Bearer (rk_[\w-]{20,100})$/.exec(header)?.[1];
    if (!key) throw new HttpError(401, 'Send the API key as Authorization: Bearer rk_….');
    const { rows } = await withScope(pool, { bypass: true }, (db) =>
      db.query<{ networkId: string; merchantId: string; name: string }>(
        `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1
         RETURNING network_id AS "networkId", merchant_id AS "merchantId", name`,
        [sha256(key)],
      ),
    );
    const found = rows.at(0);
    if (!found) throw new HttpError(401, 'That API key isn’t valid. It may have been deleted.');
    return {
      networkId: found.networkId,
      actor: { role: 'api', accountId: null, name: `API: ${found.name}`, merchantId: found.merchantId, pointId: null },
    };
  };

  /** The pick-up points nearest an address, for a shop's checkout. */
  app.get('/api/v1/points', async (request): Promise<SuggestedPoint[]> => {
    const { networkId } = await keyActor(request);
    const address = addressQuery.parse(request.query);
    return withScope(pool, { networkId }, (db) => suggestPoints(db, config, address, 10));
  });

  app.post('/api/v1/parcels', async (request, reply): Promise<Parcel> => {
    const { networkId, actor } = await keyActor(request);
    const body = z
      .object({
        pointId: uuid,
        reference: z.string().trim().max(100).nullish().transform((v) => v || null),
        customer: customerInput,
      })
      .parse(request.body);
    const parcel = await withScope(pool, { networkId }, async (db) => {
      const row = await createParcel(
        db,
        networkId,
        { ...body, merchantId: actor.merchantId ?? '' },
        actor,
        config,
      );
      return parcelDetail(db, { id: row.id }, actor, config);
    });
    void reply.code(201);
    if (!parcel) throw notFound('That parcel');
    return parcel;
  });

  app.get('/api/v1/parcels/:code', async (request): Promise<Parcel> => {
    const { networkId, actor } = await keyActor(request);
    const code = normaliseCode(z.object({ code: z.string().max(50) }).parse(request.params).code);
    if (!code) throw notFound('That parcel');
    const parcel = await withScope(pool, { networkId }, (db) =>
      parcelDetail(db, { code }, actor, config),
    );
    if (!parcel) throw notFound('That parcel');
    return parcel;
  });

  // Tracking, for the customer ------------------------------------------------------------

  app.get('/api/track/:token', async (request, reply): Promise<Tracking> => {
    const { token } = z.object({ token: z.string().regex(/^[\w-]{20,64}$/) }).parse(request.params);
    const { rows } = await withScope(pool, { bypass: true }, (db) =>
      db.query<Tracking>(
        `SELECT p.code, p.status, m.name AS merchant, p.reference, p.hold_until AS "holdUntil",
                CASE WHEN p.status = 'at_point' THEN p.pickup_code END AS "pickupCode",
                json_build_object('name', pt.name, 'street', pt.street, 'postcode', pt.postcode,
                  'city', pt.city, 'openingHours', pt.opening_hours) AS point,
                coalesce((SELECT json_agg(json_build_object('status', s.to_status, 'at', s.at) ORDER BY s.at)
                  FROM scans s WHERE s.parcel_id = p.id AND s.undone_at IS NULL), '[]') AS steps
           FROM parcels p JOIN merchants m ON m.id = p.merchant_id JOIN points pt ON pt.id = p.point_id
          WHERE p.tracking_token = $1`,
        [token],
      ),
    );
    const tracking = rows.at(0);
    if (!tracking) throw notFound('That parcel');
    // The pickup code is on this page; keep it out of shared caches.
    void reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    return tracking;
  });
}
