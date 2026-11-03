import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';
import { REMINDER_DAYS_BEFORE } from '@open-relay/contracts';
import type { Config } from './config.js';
import { type Pool, withScope } from './db.js';
import { renderEmail } from './emails.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** SMTP when OPENRELAY_SMTP_URL is set; otherwise each email goes to the log. */
export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  if (!config.smtpUrl) {
    return {
      send: (mail) => {
        log.info({ to: mail.to, subject: mail.subject }, `Email (no OPENRELAY_SMTP_URL set):\n${mail.text}`);
        return Promise.resolve();
      },
    };
  }
  const transport: Transporter = nodemailer.createTransport(config.smtpUrl);
  return {
    send: async (mail) => {
      await transport.sendMail({ from: config.mailFrom, ...mail });
    },
  };
}

/** Sends what's waiting in the outbox. Failures are tried again later, up to 8 times. */
export async function sendOutbox(pool: Pool, mailer: Mailer, limit = 50): Promise<number> {
  const due = await withScope(pool, { bypass: true }, async (db) =>
    (await db.query<Mail & { id: string; attempts: number }>(
      `SELECT id, to_email AS "to", subject, text_body AS text, html_body AS html, attempts
         FROM outbox WHERE sent_at IS NULL AND send_after <= now() AND attempts < 8
        ORDER BY send_after LIMIT $1`,
      [limit],
    )).rows,
  );
  let sent = 0;
  for (const mail of due) {
    try {
      await mailer.send(mail);
      await withScope(pool, { bypass: true }, (db) =>
        db.query('UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1', [mail.id]),
      );
      sent++;
    } catch (err) {
      // Back off: 1, 2, 4 … minutes.
      await withScope(pool, { bypass: true }, (db) =>
        db.query(
          `UPDATE outbox SET attempts = attempts + 1, last_error = $2,
             send_after = now() + make_interval(mins => power(2, attempts)::int) WHERE id = $1`,
          [mail.id, (err as Error).message.slice(0, 500)],
        ),
      );
    }
  }
  return sent;
}

/** Queues a reminder for parcels whose hold window ends within REMINDER_DAYS_BEFORE days. */
export async function queueReminders(pool: Pool, config: Config): Promise<number> {
  return withScope(pool, { bypass: true }, async (db) => {
    const { rows } = await db.query<{
      id: string;
      networkId: string;
      email: string;
      customerName: string;
      merchant: string;
      reference: string | null;
      code: string;
      pickupCode: string;
      token: string;
      holdUntil: Date;
      point: { name: string; street: string; postcode: string; city: string; openingHours: never };
    }>(
      `SELECT p.id, p.network_id AS "networkId", p.customer_email AS email, p.customer_name AS "customerName",
              m.name AS merchant, p.reference, p.code, p.pickup_code AS "pickupCode",
              p.tracking_token AS token, p.hold_until AS "holdUntil",
              json_build_object('name', pt.name, 'street', pt.street, 'postcode', pt.postcode,
                'city', pt.city, 'openingHours', pt.opening_hours) AS point
         FROM parcels p JOIN merchants m ON m.id = p.merchant_id JOIN points pt ON pt.id = p.point_id
        WHERE p.status = 'at_point' AND p.reminded_at IS NULL AND p.customer_email IS NOT NULL
          AND p.hold_until > now() AND p.hold_until <= now() + make_interval(days => $1)
        FOR UPDATE OF p SKIP LOCKED`,
      [REMINDER_DAYS_BEFORE],
    );
    for (const p of rows) {
      const mail = renderEmail('reminder', {
        customerName: p.customerName,
        merchant: p.merchant,
        reference: p.reference,
        code: p.code,
        point: p.point,
        trackingUrl: `${config.publicUrl}/t/${p.token}`,
        pickupCode: p.pickupCode,
        holdUntil: new Date(p.holdUntil),
      });
      await db.query(
        `WITH r AS (UPDATE parcels SET reminded_at = now() WHERE id = $2)
         INSERT INTO outbox (network_id, parcel_id, to_email, subject, text_body, html_body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.networkId, p.id, p.email, mail.subject, mail.text, mail.html],
      );
    }
    return rows.length;
  });
}

/** Deletes customers' details from parcels closed longer than OPENRELAY_RETENTION_DAYS ago. */
export async function forgetCustomers(pool: Pool, config: Config): Promise<number> {
  return withScope(pool, { bypass: true }, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE parcels SET customer_name = null, customer_email = null, customer_phone = null,
              customer_street = null, customer_postcode = null, customer_city = null
        WHERE closed_at < now() - make_interval(days => $1) AND customer_name IS NOT NULL`,
      [config.retentionDays],
    );
    // Sent emails hold the same details.
    await db.query(
      `DELETE FROM outbox WHERE sent_at < now() - make_interval(days => $1)`,
      [config.retentionDays],
    );
    return rowCount ?? 0;
  });
}

/** Runs the outbox every 10 seconds, and reminders and cleanup every 10 minutes. */
export function startWorker(pool: Pool, config: Config, log: FastifyBaseLogger): () => void {
  const mailer = createMailer(config, log);
  let busy = false;
  const run = (job: () => Promise<unknown>, what: string) => async () => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } catch (err) {
      log.warn({ err }, `The ${what} job failed; it runs again soon.`);
    } finally {
      busy = false;
    }
  };
  const every = (ms: number, job: () => Promise<void>) => setInterval(() => void job(), ms);
  const outbox = every(10_000, run(() => sendOutbox(pool, mailer), 'email'));
  const daily = every(
    10 * 60_000,
    run(async () => {
      await queueReminders(pool, config);
      await forgetCustomers(pool, config);
    }, 'reminder and cleanup'),
  );
  void run(async () => {
    await queueReminders(pool, config);
    await forgetCustomers(pool, config);
    await sendOutbox(pool, mailer);
  }, 'startup')();
  return () => {
    clearInterval(outbox);
    clearInterval(daily);
  };
}
