import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MembersPage, Network, NewMember } from '@open-relay/contracts';
import { hashPassword, networkAccess, newPassword, requireAccount } from '../auth.js';
import { type Pool, withScope } from '../db.js';
import { HttpError } from '../errors.js';
import { name, networkParam, slug, slugify, uuid } from './shared.js';

const role = z.enum(['admin', 'merchant', 'courier', 'point']);

/** A role with the merchant or point it belongs to; the database checks they fit together. */
const assignment = z
  .object({ role, merchantId: uuid.nullish(), pointId: uuid.nullish() })
  .transform((a) => ({
    role: a.role,
    merchantId: a.role === 'merchant' ? (a.merchantId ?? null) : null,
    pointId: a.role === 'point' ? (a.pointId ?? null) : null,
  }))
  .refine((a) => a.role !== 'merchant' || a.merchantId, { message: 'Pick the shop they work for.' })
  .refine((a) => a.role !== 'point' || a.pointId, { message: 'Pick the pick-up point they work at.' });

const MEMBER = `a.id AS "accountId", a.email, a.name, m.role,
  m.merchant_id AS "merchantId", m.point_id AS "pointId"`;

export function registerNetworkRoutes(app: FastifyInstance, pool: Pool): void {
  const serverAdmin = (request: FastifyRequest) => {
    const account = requireAccount(request);
    if (!account.isServerAdmin) throw new HttpError(403, 'Only a server admin can manage networks.');
    return account;
  };

  app.get('/api/networks', async (request): Promise<Network[]> => {
    serverAdmin(request);
    const { rows } = await pool.query<Network>(
      'SELECT id, slug, name, created_at AS "createdAt" FROM networks ORDER BY name',
    );
    return rows;
  });

  app.post('/api/networks', async (request, reply): Promise<Network> => {
    serverAdmin(request);
    const body = z.object({ name, slug: slug.optional() }).parse(request.body);
    const { rows } = await pool.query<Network>(
      `INSERT INTO networks (slug, name) VALUES ($1, $2)
       RETURNING id, slug, name, created_at AS "createdAt"`,
      [body.slug ?? slugify(body.name), body.name],
    );
    void reply.code(201);
    return rows[0];
  });

  app.patch('/api/n/:network', async (request): Promise<{ ok: true }> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin']);
    const body = z.object({ name }).parse(request.body);
    await pool.query('UPDATE networks SET name = $2 WHERE id = $1', [access.networkId, body.name]);
    return { ok: true };
  });

  app.delete('/api/n/:network', async (request): Promise<{ ok: true }> => {
    serverAdmin(request);
    const { network } = networkParam.parse(request.params);
    await pool.query('DELETE FROM networks WHERE slug = $1', [network]);
    return { ok: true };
  });

  // Members --------------------------------------------------------------------------------

  app.get('/api/n/:network/members', async (request): Promise<MembersPage> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin']);
    return withScope(pool, { networkId: access.networkId }, async (db) => {
      const { rows } = await db.query<MembersPage>(
        `SELECT
           coalesce((SELECT json_agg(x ORDER BY x.name, x.email) FROM (SELECT ${MEMBER}
             FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.network_id = $1) x),
             '[]') AS members,
           coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
             FROM merchants), '[]') AS merchants,
           coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
             FROM points), '[]') AS points`,
        [access.networkId],
      );
      return rows[0];
    });
  });

  /** Adds someone by email. A new account gets a password, shown this once. */
  app.post('/api/n/:network/members', async (request, reply): Promise<NewMember> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin']);
    const body = z
      .object({ email: z.email().max(200), name: z.string().trim().max(120).default('') })
      .and(assignment)
      .parse(request.body);
    const email = body.email.toLowerCase();
    const password = newPassword();
    await checkBelongs(pool, access.networkId, body);
    const created = await pool.query<{ id: string; name: string; created: boolean }>(
      `INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, name, (xmax = 0) AS created`,
      [email, body.name, await hashPassword(password)],
    );
    const account = created.rows[0];
    const inserted = await pool.query(
      `INSERT INTO memberships (network_id, account_id, role, merchant_id, point_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [access.networkId, account.id, body.role, body.merchantId, body.pointId],
    );
    if (!inserted.rowCount) throw new HttpError(409, `${email} is already a member.`);
    void reply.code(201);
    return {
      accountId: account.id,
      email,
      name: account.name,
      role: body.role,
      merchantId: body.merchantId,
      pointId: body.pointId,
      password: account.created ? password : null,
    };
  });

  app.patch('/api/n/:network/members/:accountId', async (request): Promise<{ ok: true }> => {
    const params = z.object({ network: slug, accountId: uuid }).parse(request.params);
    const access = await networkAccess(pool, request, params.network, ['admin']);
    // Nobody changes their own role: an admin can't lock the network out by accident, and
    // nobody can raise their own rights.
    if (params.accountId === access.account.id) {
      throw new HttpError(403, 'You can’t change your own role. Ask another admin.');
    }
    const body = assignment.parse(request.body);
    await checkBelongs(pool, access.networkId, body);
    const result = await pool.query(
      `UPDATE memberships SET role = $3, merchant_id = $4, point_id = $5
        WHERE network_id = $1 AND account_id = $2`,
      [access.networkId, params.accountId, body.role, body.merchantId, body.pointId],
    );
    if (!result.rowCount) throw new HttpError(404, 'That member wasn’t found.');
    return { ok: true };
  });

  app.delete('/api/n/:network/members/:accountId', async (request): Promise<{ ok: true }> => {
    const params = z.object({ network: slug, accountId: uuid }).parse(request.params);
    const access = await networkAccess(pool, request, params.network, ['admin']);
    if (params.accountId === access.account.id) {
      throw new HttpError(403, 'You can’t remove yourself. Ask another admin.');
    }
    await pool.query('DELETE FROM memberships WHERE network_id = $1 AND account_id = $2', [
      access.networkId,
      params.accountId,
    ]);
    return { ok: true };
  });
}

/** The merchant or point someone is assigned to must be in this network. */
async function checkBelongs(
  pool: Pool,
  networkId: string,
  a: { merchantId: string | null; pointId: string | null },
): Promise<void> {
  if (!a.merchantId && !a.pointId) return;
  const found = await withScope(pool, { networkId }, async (db) => {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM merchants WHERE id = $1))
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM points WHERE id = $2)) AS ok`,
      [a.merchantId, a.pointId],
    );
    return rows[0].ok;
  });
  if (!found) throw new HttpError(400, 'That shop or pick-up point isn’t in this network.');
}
