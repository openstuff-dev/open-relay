import {
  canCancel,
  type Customer,
  NEEDS_PICKUP_CODE,
  nextStatus,
  type Parcel,
  type ParcelRow,
  type ParcelStatus,
  type Role,
  type Scan,
  type ScanResult,
  UNDO_MINUTES,
} from '@open-relay/contracts';
import type { Config } from './config.js';
import type { Client } from './db.js';
import { type EmailKind, type PointInfo, renderEmail } from './emails.js';
import { HttpError } from './errors.js';
import { newParcelCode, newPickupCode, newTrackingToken } from './routes/shared.js';

/** Who makes a step: a member in a role, or a shop's API key. */
export interface Actor {
  role: Role | 'api';
  accountId: string | null;
  name: string;
  merchantId: string | null;
  pointId: string | null;
}

/** The columns of a ParcelRow, for `FROM parcels p JOIN merchants m … JOIN points pt …`. */
export const ROW_COLUMNS = `p.id, p.code, p.reference, p.status,
  json_build_object('id', m.id, 'name', m.name) AS merchant,
  json_build_object('id', pt.id, 'name', pt.name) AS point,
  p.customer_name AS "customerName", p.hold_until AS "holdUntil",
  (p.status = 'at_point' AND p.hold_until < now()) AS overdue, p.updated_at AS "updatedAt"`;

export const ROW_FROM = `parcels p JOIN merchants m ON m.id = p.merchant_id
  JOIN points pt ON pt.id = p.point_id`;

/** Everything a step needs about a parcel: its row, the customer and the email's content. */
interface Loaded extends ParcelRow {
  merchantId: string;
  pointId: string;
  pickupCode: string;
  trackingToken: string;
  customerEmail: string | null;
  pointInfo: PointInfo;
}

const LOAD = `SELECT ${ROW_COLUMNS}, p.merchant_id AS "merchantId", p.point_id AS "pointId",
    p.pickup_code AS "pickupCode", p.tracking_token AS "trackingToken",
    p.customer_email AS "customerEmail",
    json_build_object('name', pt.name, 'street', pt.street, 'postcode', pt.postcode,
      'city', pt.city, 'openingHours', pt.opening_hours) AS "pointInfo"
  FROM ${ROW_FROM}`;

/** A Loaded parcel without the parts staff never see. */
export function toRow(p: Loaded): ParcelRow {
  return {
    id: p.id,
    code: p.code,
    reference: p.reference,
    status: p.status,
    merchant: p.merchant,
    point: p.point,
    customerName: p.customerName,
    holdUntil: p.holdUntil,
    overdue: p.overdue,
    updatedAt: p.updatedAt,
  };
}

/** Point staff see a parcel once it's on its way to them. */
const POINT_SEES: ParcelStatus[] = ['in_transit', 'at_point', 'collected'];

/** May this actor see the parcel at all? Merchant and point staff see only their own. */
export function canSee(actor: Pick<Actor, 'role' | 'merchantId' | 'pointId'>, p: Loaded | ParcelRow) {
  const merchantId = 'merchantId' in p ? p.merchantId : p.merchant.id;
  const pointId = 'pointId' in p ? p.pointId : p.point.id;
  if (actor.role === 'merchant' || actor.role === 'api') return merchantId === actor.merchantId;
  if (actor.role === 'point') return pointId === actor.pointId && POINT_SEES.includes(p.status);
  return true;
}

/** The SQL condition for what an actor sees in lists, on `p`. Values are UUIDs from the session. */
export function visibleSql(actor: Pick<Actor, 'role' | 'merchantId' | 'pointId'>): string {
  if (actor.role === 'merchant' || actor.role === 'api') return `p.merchant_id = '${actor.merchantId}'`;
  if (actor.role === 'point') {
    const statuses = POINT_SEES.map((st) => `'${st}'`).join(', ');
    return `p.point_id = '${actor.pointId}' AND p.status IN (${statuses})`;
  }
  return 'true';
}

function emailFor(kind: EmailKind, p: Loaded, config: Config, holdUntil: Date | null) {
  if (!p.customerEmail || !p.customerName) return null;
  return {
    to: p.customerEmail,
    ...renderEmail(kind, {
      customerName: p.customerName,
      merchant: p.merchant.name,
      reference: p.reference,
      code: p.code,
      point: p.pointInfo,
      trackingUrl: `${config.publicUrl}/t/${p.trackingToken}`,
      pickupCode: p.pickupCode,
      holdUntil,
    }),
  };
}

const EMAIL_ON: Partial<Record<ParcelStatus, EmailKind>> = {
  registered: 'registered',
  in_transit: 'in_transit',
  at_point: 'at_point',
  collected: 'collected',
  cancelled: 'cancelled',
};

/**
 * Moves a parcel to `to` in one statement: the status, the scan and the customer's email,
 * so a step and its email are saved together or not at all.
 */
async function step(
  db: Client,
  networkId: string,
  p: Loaded,
  to: ParcelStatus,
  actor: Actor,
  config: Config,
): Promise<{ scanId: string; at: string; holdUntil: string | null }> {
  const holdUntil = to === 'at_point' ? new Date(Date.now() + config.holdDays * 86400_000) : null;
  const kind = EMAIL_ON[to];
  const email = kind ? emailFor(kind, p, config, holdUntil) : null;
  const closed = to === 'collected' || to === 'cancelled';
  const { rows } = await db.query<{ scanId: string; at: string; holdUntil: string | null }>(
    `WITH u AS (
       UPDATE parcels SET status = $2::parcel_status, updated_at = now(),
         hold_until = CASE WHEN $2::parcel_status = 'at_point' THEN $12::timestamptz ELSE hold_until END,
         reminded_at = CASE WHEN $2::parcel_status = 'at_point' THEN null ELSE reminded_at END,
         closed_at = CASE WHEN $13 THEN now() ELSE null END
       WHERE id = $1 RETURNING id, hold_until),
     s AS (
       INSERT INTO scans (network_id, parcel_id, from_status, to_status, role, account_id, by_name)
       SELECT $3, u.id, $4::parcel_status, $2::parcel_status, $5, $6, $7 FROM u RETURNING id, at),
     o AS (
       INSERT INTO outbox (network_id, parcel_id, scan_id, to_email, subject, text_body, html_body)
       SELECT $3, $1, s.id, $8, $9, $10, $11 FROM s WHERE $8::text IS NOT NULL)
     SELECT s.id AS "scanId", s.at, u.hold_until AS "holdUntil" FROM s, u`,
    [
      p.id,
      to,
      networkId,
      p.status,
      actor.role,
      actor.accountId,
      actor.name,
      email?.to ?? null,
      email?.subject ?? null,
      email?.text ?? null,
      email?.html ?? null,
      holdUntil,
      closed,
    ],
  );
  const row = rows.at(0);
  if (!row) throw new HttpError(409, 'The parcel changed meanwhile. Scan it again.');
  return row;
}

async function loadByCode(db: Client, code: string): Promise<Loaded | undefined> {
  const { rows } = await db.query<Loaded>(`${LOAD} WHERE p.code = $1 FOR UPDATE OF p`, [code]);
  return rows.at(0);
}

/** Wrong pickup codes per parcel, so nobody can try all million of them. */
const wrongCodes = new Map<string, { count: number; until: number }>();
const MAX_WRONG_CODES = 5;

export class ScanRefusedError extends HttpError {
  constructor(
    status: number,
    message: string,
    readonly parcel?: ParcelRow,
    readonly needsPickupCode?: boolean,
  ) {
    super(status, message);
  }
}

/** One scan of a label: the next step for the actor's role, or a refusal that says why. */
export async function scan(
  db: Client,
  networkId: string,
  code: string,
  pickupCode: string | undefined,
  actor: Actor,
  config: Config,
): Promise<ScanResult> {
  const p = await loadByCode(db, code);
  if (!p) throw new ScanRefusedError(404, 'No parcel has that code in this network.');
  const row = toRow(p);
  const shown = canSee(actor, p) ? row : undefined;
  if (actor.role === 'merchant' && p.merchantId !== actor.merchantId) {
    throw new ScanRefusedError(403, 'This parcel belongs to another shop.');
  }
  if (actor.role === 'point' && p.pointId !== actor.pointId) {
    throw new ScanRefusedError(403, `This parcel goes to ${p.point.name}, not here.`);
  }
  const outcome = nextStatus(actor.role === 'api' ? 'merchant' : actor.role, p.status);
  if (!outcome.ok) throw new ScanRefusedError(409, outcome.reason, shown);

  if (p.status === NEEDS_PICKUP_CODE) {
    const tries = wrongCodes.get(p.id);
    if (tries && tries.until > Date.now() && tries.count >= MAX_WRONG_CODES) {
      throw new ScanRefusedError(429, 'Too many wrong pickup codes. Try again in 15 minutes.', shown);
    }
    if (!pickupCode) {
      throw new ScanRefusedError(409, 'Scan or type the customer’s pickup code.', shown, true);
    }
    if (pickupCode !== p.pickupCode) {
      const count = (tries && tries.until > Date.now() ? tries.count : 0) + 1;
      wrongCodes.set(p.id, { count, until: Date.now() + 15 * 60_000 });
      throw new ScanRefusedError(409, 'That pickup code isn’t right for this parcel.', shown, true);
    }
    wrongCodes.delete(p.id);
  }

  const done = await step(db, networkId, p, outcome.to, actor, config);
  return {
    scanId: done.scanId,
    parcel: {
      ...row,
      status: outcome.to,
      holdUntil: done.holdUntil,
      overdue: false,
      updatedAt: done.at,
    },
    from: p.status,
    to: outcome.to,
    undoUntil: new Date(new Date(done.at).getTime() + UNDO_MINUTES * 60_000).toISOString(),
  };
}

/**
 * Undoes a step its author made in the last few minutes, if nothing happened to the parcel
 * since. Emails it queued that haven't gone out are dropped.
 */
export async function undoScan(db: Client, scanId: string, accountId: string): Promise<ParcelRow> {
  const { rows } = await db.query<{ parcelId: string }>(
    `WITH target AS (
       SELECT s.id, s.parcel_id, s.from_status FROM scans s JOIN parcels p ON p.id = s.parcel_id
        WHERE s.id = $1 AND s.account_id = $2 AND s.undone_at IS NULL AND s.from_status IS NOT NULL
          AND s.at > now() - make_interval(mins => $3) AND p.status = s.to_status
          AND NOT EXISTS (SELECT 1 FROM scans later WHERE later.parcel_id = s.parcel_id
                            AND later.undone_at IS NULL AND later.at > s.at)
        FOR UPDATE OF p),
     moved AS (
       UPDATE parcels SET status = target.from_status, updated_at = now(), closed_at = null,
         hold_until = CASE WHEN target.from_status = 'at_point' THEN hold_until ELSE null END
       FROM target WHERE parcels.id = target.parcel_id RETURNING parcels.id),
     s AS (UPDATE scans SET undone_at = now() FROM target WHERE scans.id = target.id),
     o AS (DELETE FROM outbox USING target WHERE outbox.scan_id = target.id AND sent_at IS NULL)
     SELECT id AS "parcelId" FROM moved`,
    [scanId, accountId, UNDO_MINUTES],
  );
  const parcelId = rows.at(0)?.parcelId;
  if (!parcelId) {
    throw new HttpError(409, `Only your own last scan of a parcel can be undone, within ${UNDO_MINUTES} minutes.`);
  }
  const loaded = await db.query<Loaded>(`${LOAD} WHERE p.id = $1`, [parcelId]);
  return toRow(loaded.rows[0]);
}

/** Cancels a parcel before a courier has it. */
export async function cancelParcel(
  db: Client,
  networkId: string,
  id: string,
  actor: Actor,
  config: Config,
): Promise<ParcelRow> {
  const { rows } = await db.query<Loaded>(`${LOAD} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
  const p = rows.at(0);
  if (!p || !canSee(actor, p)) throw new HttpError(404, 'That parcel wasn’t found.');
  if (!canCancel(p.status)) {
    throw new HttpError(409, 'A courier has this parcel already, so it can’t be cancelled.');
  }
  const done = await step(db, networkId, p, 'cancelled', actor, config);
  return { ...toRow(p), status: 'cancelled', updatedAt: done.at };
}

export interface NewParcelInput {
  merchantId: string;
  pointId: string;
  reference: string | null;
  customer: Customer;
}

/** Registers a parcel and emails the customer where it's going. */
export async function createParcel(
  db: Client,
  networkId: string,
  input: NewParcelInput,
  actor: Actor,
  config: Config,
): Promise<ParcelRow> {
  const c = input.customer;
  for (let attempt = 0; ; attempt++) {
    // A savepoint, so a clash of codes (1 in a trillion) doesn't end the transaction.
    await db.query('SAVEPOINT new_parcel');
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO parcels (network_id, merchant_id, point_id, code, tracking_token, pickup_code,
           reference, customer_name, customer_email, customer_phone, customer_street,
           customer_postcode, customer_city)
         SELECT $1, m.id, pt.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
           FROM merchants m, points pt WHERE m.id = $2 AND pt.id = $3 AND pt.active
         RETURNING id`,
        [
          networkId,
          input.merchantId,
          input.pointId,
          newParcelCode(),
          newTrackingToken(),
          newPickupCode(),
          input.reference,
          c.name,
          c.email.toLowerCase(),
          c.phone,
          c.street,
          c.postcode,
          c.city,
        ],
      );
      const id = rows.at(0)?.id;
      if (!id) throw new HttpError(400, 'That shop or pick-up point wasn’t found, or the point is closed.');
      await db.query('RELEASE SAVEPOINT new_parcel');
      const loaded = await db.query<Loaded>(`${LOAD} WHERE p.id = $1`, [id]);
      const p = loaded.rows[0];
      // The first scan has no "from": it's the parcel being registered.
      const email = emailFor('registered', p, config, null);
      await db.query(
        `WITH s AS (INSERT INTO scans (network_id, parcel_id, from_status, to_status, role, account_id, by_name)
                    VALUES ($1, $2, null, 'registered', $3, $4, $5) RETURNING id)
         INSERT INTO outbox (network_id, parcel_id, scan_id, to_email, subject, text_body, html_body)
         SELECT $1, $2, s.id, $6, $7, $8, $9 FROM s WHERE $6::text IS NOT NULL`,
        [
          networkId,
          id,
          actor.role,
          actor.accountId,
          actor.name,
          email?.to ?? null,
          email?.subject ?? null,
          email?.text ?? null,
          email?.html ?? null,
        ],
      );
      return toRow(p);
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT new_parcel');
      const clash = (err as { constraint?: string }).constraint === 'parcels_code_key';
      if (!clash || attempt >= 3) throw err;
    }
  }
}

/** One parcel with its customer and history, as the actor may see it. */
export async function parcelDetail(
  db: Client,
  where: { id: string } | { code: string },
  actor: Pick<Actor, 'role' | 'merchantId' | 'pointId'>,
  config: Config,
): Promise<Parcel | null> {
  const byId = 'id' in where;
  type Detail = Loaded & { createdAt: string; customer: Customer | null; scans: Scan[] };
  const { rows } = await db.query<Detail>(
    `${LOAD.replace(' FROM ', `, p.created_at AS "createdAt",
       CASE WHEN p.customer_name IS NULL THEN null ELSE json_build_object('name', p.customer_name,
         'email', p.customer_email, 'phone', p.customer_phone, 'street', p.customer_street,
         'postcode', p.customer_postcode, 'city', p.customer_city) END AS customer,
       coalesce((SELECT json_agg(json_build_object('id', s.id, 'from', s.from_status, 'to', s.to_status,
         'role', s.role, 'by', s.by_name, 'at', s.at, 'undoneAt', s.undone_at) ORDER BY s.at)
         FROM scans s WHERE s.parcel_id = p.id), '[]') AS scans
     FROM `)} WHERE ${byId ? 'p.id = $1' : 'p.code = $1'}`,
    [byId ? where.id : where.code],
  );
  const p = rows.at(0);
  if (!p || !canSee(actor, p)) return null;
  const isShop = actor.role === 'admin' || actor.role === 'merchant' || actor.role === 'api';
  return {
    ...toRow(p),
    // Couriers only carry the parcel; they don't need the customer's details.
    customer: actor.role === 'courier' ? null : p.customer,
    trackingUrl: isShop ? `${config.publicUrl}/t/${p.trackingToken}` : null,
    createdAt: p.createdAt,
    scans: p.scans,
  };
}
