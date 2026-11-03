import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  type CsvImportResult,
  formatCode,
  normaliseCode,
  type Parcel,
  type ParcelRow,
  type ParcelsPage,
  type PickupStop,
  type ScanResult,
  STATUSES,
} from '@open-relay/contracts';
import { type NetworkAccess, networkAccess } from '../auth.js';
import type { Config } from '../config.js';
import { type Pool, withScope } from '../db.js';
import { escapeHtml } from '../emails.js';
import { HttpError, notFound } from '../errors.js';
import {
  type Actor,
  cancelParcel,
  createParcel,
  parcelDetail,
  ROW_COLUMNS,
  ROW_FROM,
  scan,
  ScanRefusedError,
  undoScan,
  visibleSql,
} from '../parcels.js';
import { suggestPoints } from '../points.js';
import { parseCsv } from '../csv.js';
import { idParam, networkParam, uuid } from './shared.js';

const ALL = ['admin', 'merchant', 'courier', 'point'] as const;

export const customerInput = z.object({
  name: z.string().trim().min(1, 'Add the customer’s name.').max(120),
  email: z.email('Add the customer’s email.').max(200),
  phone: z.string().trim().max(40).nullish().transform((v) => v || null),
  street: z.string().trim().max(200).default(''),
  postcode: z.string().trim().max(20).default(''),
  city: z.string().trim().max(100).default(''),
});

export const parcelInput = z.object({
  merchantId: uuid.optional(),
  pointId: uuid,
  reference: z.string().trim().max(100).nullish().transform((v) => v || null),
  customer: customerInput,
});

const listQuery = z.object({
  status: z.enum([...STATUSES, 'overdue']).optional(),
  merchantId: uuid.optional(),
  pointId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const PAGE_SIZE = 50;

type Access = NetworkAccess & { account: { id: string; name: string; email: string } };

export const actorOf = (access: Access): Actor => ({
  role: access.role,
  accountId: access.account.id,
  name: access.account.name || access.account.email,
  merchantId: access.merchantId,
  pointId: access.pointId,
});

export function registerParcelRoutes(app: FastifyInstance, pool: Pool, config: Config): void {
  /** A page of parcels, with what the filters offer, in one query. */
  app.get('/api/n/:network/parcels', async (request): Promise<ParcelsPage> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ALL);
    const query = listQuery.parse(request.query);
    const where = [visibleSql(access)];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace('?', `$${values.length}`));
    };
    if (query.status === 'overdue') where.push(`p.status = 'at_point' AND p.hold_until < now()`);
    else if (query.status) add('p.status = ?', query.status);
    if (query.merchantId) add('p.merchant_id = ?', query.merchantId);
    if (query.pointId) add('p.point_id = ?', query.pointId);
    if (query.q) {
      const code = normaliseCode(query.q);
      values.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const like = `$${values.length}`;
      where.push(`(p.reference ILIKE ${like} OR p.customer_name ILIKE ${like}
        OR p.customer_email ILIKE ${like}${code ? ` OR p.code = '${code}'` : ''})`);
    }
    values.push(PAGE_SIZE, (query.page - 1) * PAGE_SIZE);
    const filter = where.join(' AND ');
    return withScope(pool, { networkId: access.networkId }, async (db) => {
      const { rows } = await db.query<ParcelsPage>(
        `SELECT
           coalesce((SELECT json_agg(r) FROM (SELECT ${ROW_COLUMNS} FROM ${ROW_FROM} WHERE ${filter}
              ORDER BY p.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}) r), '[]')
             AS parcels,
           (SELECT count(*)::int FROM ${ROW_FROM} WHERE ${filter}) AS total,
           coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
              FROM merchants), '[]') AS merchants,
           coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
              FROM points), '[]') AS points`,
        values,
      );
      return rows[0];
    });
  });

  app.post('/api/n/:network/parcels', async (request, reply): Promise<ParcelRow> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin', 'merchant']);
    const body = parcelInput.parse(request.body);
    const merchantId = access.role === 'merchant' ? access.merchantId : body.merchantId;
    if (!merchantId) throw new HttpError(400, 'Pick the shop the parcel is from.');
    const parcel = await withScope(pool, { networkId: access.networkId }, (db) =>
      createParcel(db, access.networkId, { ...body, merchantId }, actorOf(access), config),
    );
    void reply.code(201);
    return parcel;
  });

  /**
   * Parcels from a CSV file: name, email, phone, street, postcode, city, reference and point
   * (its name; empty: the nearest one). Rows that fail are listed; the others are added.
   */
  app.post('/api/n/:network/parcels/import', { bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin', 'merchant']);
    const body = z
      .object({ csv: z.string().max(5_000_000), merchantId: uuid.optional() })
      .parse(request.body);
    const merchantId = access.role === 'merchant' ? access.merchantId : body.merchantId;
    if (!merchantId) throw new HttpError(400, 'Pick the shop the parcels are from.');
    const [header, ...lines] = parseCsv(body.csv) as [string[] | undefined, ...string[][]];
    if (!header) throw new HttpError(400, 'The file is empty.');
    if (lines.length > 2000) throw new HttpError(400, 'Import at most 2,000 parcels at a time.');
    const columns = header.map((h) => h.trim().toLowerCase());
    for (const needed of ['name', 'email']) {
      if (!columns.includes(needed)) throw new HttpError(400, `The first row needs a "${needed}" column.`);
    }
    const result: CsvImportResult = { created: 0, errors: [] };
    await withScope(pool, { networkId: access.networkId }, async (db) => {
      const { rows: points } = await db.query<{ id: string; name: string; slug: string }>(
        'SELECT id, name, slug FROM points WHERE active',
      );
      for (const [i, line] of lines.entries()) {
        const row: Record<string, string | undefined> = Object.fromEntries(
          columns.map((c, j) => [c, line.at(j)?.trim() ?? '']),
        );
        if (Object.values(row).every((v) => !v)) continue;
        const customer = customerInput.safeParse(row);
        if (!customer.success) {
          result.errors.push({ row: i + 2, error: customer.error.issues[0].message });
          continue;
        }
        const wanted = (row.point ?? '').toLowerCase();
        const pointId = wanted
          ? points.find((p) => p.name.toLowerCase() === wanted || p.slug === wanted)?.id
          : (await suggestPoints(db, config, customer.data, 1)).at(0)?.id;
        if (!pointId) {
          result.errors.push({ row: i + 2, error: wanted ? `No open point is called "${row.point}".` : 'There are no open points.' });
          continue;
        }
        await createParcel(
          db,
          access.networkId,
          { merchantId, pointId, reference: row.reference || null, customer: customer.data },
          actorOf(access),
          config,
        );
        result.created++;
      }
    });
    return result;
  });

  app.get('/api/n/:network/parcels/:id', async (request): Promise<Parcel> => {
    const { network, id } = idParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ALL);
    const parcel = await withScope(pool, { networkId: access.networkId }, (db) =>
      parcelDetail(db, { id }, access, config),
    );
    if (!parcel) throw notFound('That parcel');
    return parcel;
  });

  app.post('/api/n/:network/parcels/:id/cancel', async (request): Promise<ParcelRow> => {
    const { network, id } = idParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin', 'merchant']);
    return withScope(pool, { networkId: access.networkId }, (db) =>
      cancelParcel(db, access.networkId, id, actorOf(access), config),
    );
  });

  // Scans ----------------------------------------------------------------------------------

  /** One scan of a label. The scanner's role decides the step; refusals say why. */
  app.post('/api/n/:network/scan', async (request, reply): Promise<ScanResult> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ALL);
    const body = z
      .object({ code: z.string().max(300), pickupCode: z.string().trim().regex(/^\d{6}$/).optional() })
      .parse(request.body);
    const code = normaliseCode(body.code);
    if (!code) throw new HttpError(400, 'That isn’t a parcel code. They look like 7K3M-Q9XD.');
    try {
      return await withScope(pool, { networkId: access.networkId }, (db) =>
        scan(db, access.networkId, code, body.pickupCode, actorOf(access), config),
      );
    } catch (err) {
      if (!(err instanceof ScanRefusedError)) throw err;
      return reply.code(err.status).send({
        error: err.message,
        parcel: err.parcel,
        needsPickupCode: err.needsPickupCode,
      }) as never;
    }
  });

  app.post('/api/n/:network/scans/:id/undo', async (request): Promise<ParcelRow> => {
    const { network, id } = idParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ALL);
    return withScope(pool, { networkId: access.networkId }, (db) =>
      undoScan(db, id, access.account.id),
    );
  });

  /** The courier's round: parcels ready at each shop. */
  app.get('/api/n/:network/pickups', async (request): Promise<PickupStop[]> => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin', 'courier']);
    return withScope(pool, { networkId: access.networkId }, async (db) => {
      const { rows } = await db.query<PickupStop>(
        `SELECT json_build_object('id', m.id, 'name', m.name, 'address', m.address) AS merchant,
                json_agg(json_build_object('id', p.id, 'code', p.code, 'point', pt.name)
                  ORDER BY pt.name, p.code) AS parcels
           FROM ${ROW_FROM} WHERE p.status = 'ready'
          GROUP BY m.id ORDER BY m.name`,
      );
      return rows;
    });
  });

  // Labels ---------------------------------------------------------------------------------

  /** Printable labels, 100 × 150 mm, one per page: `?ids=…,…`. */
  app.get('/api/n/:network/labels', async (request, reply) => {
    const { network } = networkParam.parse(request.params);
    const access = await networkAccess(pool, request, network, ['admin', 'merchant']);
    const { ids } = z
      .object({ ids: z.string().transform((s) => s.split(',')).pipe(z.array(uuid).min(1).max(500)) })
      .parse(request.query);
    const parcels = await withScope(pool, { networkId: access.networkId }, async (db) => {
      const { rows } = await db.query<{
        code: string;
        reference: string | null;
        customer: string | null;
        merchant: string;
        point: string;
        pointAddress: string;
      }>(
        `SELECT p.code, p.reference, p.customer_name AS customer, m.name AS merchant, pt.name AS point,
                pt.street || ', ' || pt.postcode || ' ' || pt.city AS "pointAddress"
           FROM ${ROW_FROM} WHERE p.id = ANY($1) AND ${visibleSql(access)} ORDER BY p.created_at`,
        [ids],
      );
      return rows;
    });
    if (parcels.length === 0) throw notFound('Those parcels');
    const labels = await Promise.all(parcels.map(async (p) => {
      const qr = await QRCode.toString(`${config.publicUrl}/s/${formatCode(p.code)}`, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M',
      });
      const e = escapeHtml;
      return `<section class="label">
  <p class="to">To pick-up point</p>
  <p class="point">${e(p.point)}</p>
  <p class="address">${e(p.pointAddress)}</p>
  <p class="customer">${e(p.customer ?? '')}</p>
  <div class="qr">${qr}</div>
  <p class="code">${e(formatCode(p.code))}</p>
  <p class="from">From ${e(p.merchant)}${p.reference ? ` · ${e(p.reference)}` : ''}</p>
</section>`;
    }));
    void reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    return LABEL_PAGE.replace('{{count}}', String(labels.length)).replace('{{labels}}', labels.join('\n'));
  });
}

// Plain black on white: labels are printed, often on thermal printers.
const LABEL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{count}} OpenRelay labels</title>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; background: #fff; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 12px 16px;
         background: #f4f4f4; border-bottom: 1px solid #ccc; }
  .bar button { font: inherit; padding: 8px 16px; min-height: 44px; cursor: pointer; }
  .label { width: 100mm; height: 150mm; padding: 6mm; margin: 16px auto; border: 1px dashed #999;
           display: flex; flex-direction: column; break-after: page; overflow: hidden; }
  .label p { margin: 0; }
  .to { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; }
  .point { font-size: 20pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
  .address { font-size: 10pt; margin-top: 1mm !important; }
  .customer { font-size: 14pt; font-weight: 600; margin-top: 5mm !important; overflow-wrap: anywhere; }
  .qr { width: 55mm; margin: auto auto 0; }
  .qr svg { display: block; width: 100%; height: auto; }
  .code { text-align: center; font: 700 22pt/1.2 ui-monospace, monospace; letter-spacing: 0.06em;
          margin-top: 3mm !important; }
  .from { font-size: 9pt; text-align: center; margin-top: 2mm !important; }
  @media print {
    .bar { display: none; }
    .label { margin: 0; border: 0; }
  }
</style>
</head>
<body>
<div class="bar"><button type="button" onclick="print()">Print {{count}} label(s)</button>
<span>100 × 150 mm, one per page.</span></div>
{{labels}}
</body>
</html>`;
