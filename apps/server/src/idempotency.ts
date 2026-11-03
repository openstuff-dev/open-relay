import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

interface Entry {
  status: number;
  payload: string | null;
  until: number;
}

const TTL = 24 * 3600_000;
const MAX = 10_000;

/**
 * POSTs with an Idempotency-Key header run once per account and key: a retry or a double click
 * gets the first answer back instead of creating a second record. Kept in memory for a day.
 */
export function registerIdempotency(app: FastifyInstance): void {
  const entries = new Map<string, Entry | 'running'>();
  const keyOf = (request: FastifyRequest) => {
    const header = request.headers['idempotency-key'];
    if (request.method !== 'POST' || typeof header !== 'string' || !request.account) return null;
    return `${request.account.id}|${request.url}|${header.slice(0, 100)}`;
  };

  // After the auth hook, so the account is known.
  app.addHook('preHandler', async (request, reply) => {
    const key = keyOf(request);
    if (!key) return;
    const entry = entries.get(key);
    if (entry === 'running') throw new HttpError(409, 'That request is still running.');
    if (entry && entry.until > Date.now()) {
      void reply.header('Idempotent-Replayed', 'true').code(entry.status).type('application/json');
      return reply.send(entry.payload);
    }
    entries.set(key, 'running');
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const key = keyOf(request);
    if (!key || entries.get(key) !== 'running') return payload;
    if (reply.statusCode >= 500) entries.delete(key);
    else {
      if (entries.size > MAX) entries.clear();
      entries.set(key, { status: reply.statusCode, payload: typeof payload === 'string' ? payload : null, until: Date.now() + TTL });
    }
    return payload;
  });
}
