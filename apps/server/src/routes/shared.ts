import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { CODE_ALPHABET } from '@open-relay/contracts';

export const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Use lowercase letters, digits and dashes.');
export const name = z.string().trim().min(1, 'Give it a name.').max(120);
export const uuid = z.uuid();
export const networkParam = z.object({ network: slug });
export const idParam = z.object({ network: slug, id: uuid });

/** A slug from a name: "Corner Shop" → "corner-shop". */
export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return s || 'item';
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** 8 Crockford base32 characters: 40 bits, shown as `7K3M-Q9XD`. */
export function newParcelCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(32)]).join('');
}

export const newPickupCode = () => String(randomInt(1_000_000)).padStart(6, '0');
export const newTrackingToken = () => randomBytes(24).toString('base64url');
export const newApiKey = () => `rk_${randomBytes(32).toString('base64url')}`;
