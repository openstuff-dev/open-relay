import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** An error the client caused, with a message to show as is. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} wasn't found.`);

/** Turns thrown errors into `{ error }` answers with the right status. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError | ZodError, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof ZodError) {
      const issue = error.issues.at(0);
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return reply.code(400).send({ error: `${where}${issue?.message ?? 'Invalid request.'}` });
    }
    const code = (error as { code?: string }).code;
    if (code === '23505') return reply.code(409).send({ error: 'That slug or email is already taken.' });
    if (code === '23514' || code === '22P02' || code === '23503') {
      return reply.code(400).send({ error: 'Some of the values aren’t allowed.' });
    }
    const status = (error).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: error.message });
    request.log.error(error);
    return reply.code(500).send({ error: 'Something went wrong on the server.' });
  });
}
