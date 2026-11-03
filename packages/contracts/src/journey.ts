/**
 * A parcel's journey: which status comes next, and who may move it there. This is the one
 * source; the server checks every scan against it and the database CHECK lists the same statuses.
 */

/** What a member does in a network. Merchant and point staff belong to one merchant or point. */
export type Role = 'admin' | 'merchant' | 'courier' | 'point';

export const STATUSES = ['registered', 'ready', 'in_transit', 'at_point', 'collected', 'cancelled'] as const;
export type ParcelStatus = (typeof STATUSES)[number];

/** Who scans the label to move a parcel out of each status, and where it goes. */
const STEPS: Partial<Record<ParcelStatus, { by: Exclude<Role, 'admin'>; to: ParcelStatus }>> = {
  registered: { by: 'merchant', to: 'ready' },
  ready: { by: 'courier', to: 'in_transit' },
  in_transit: { by: 'point', to: 'at_point' },
  at_point: { by: 'point', to: 'collected' },
};

/** Scanning a label in this status as point staff needs the customer's pickup code. */
export const NEEDS_PICKUP_CODE: ParcelStatus = 'at_point';

export type ScanOutcome = { ok: true; to: ParcelStatus } | { ok: false; reason: string };

/** What has to happen next, said for someone holding the parcel. */
const WAITING_FOR: Record<ParcelStatus, string> = {
  registered: 'The shop hasn’t marked this parcel ready yet.',
  ready: 'This parcel is waiting for a courier at the shop.',
  in_transit: 'This parcel is on its way to the pick-up point.',
  at_point: 'This parcel is at the pick-up point, waiting for the customer.',
  collected: 'This parcel has already been collected.',
  cancelled: 'This parcel was cancelled.',
};

/**
 * The status a scan by `role` moves a parcel in `status` to, or why it can't. Admins may make
 * any step. Whether point staff work at the parcel's own point is checked by the server.
 */
export function nextStatus(role: Role, status: ParcelStatus): ScanOutcome {
  const step = STEPS[status];
  if (!step) return { ok: false, reason: WAITING_FOR[status] };
  if (role !== 'admin' && role !== step.by) return { ok: false, reason: WAITING_FOR[status] };
  return { ok: true, to: step.to };
}

/** Parcels can be cancelled until a courier has them. */
export const canCancel = (status: ParcelStatus) => status === 'registered' || status === 'ready';

/** How long the author of a scan may undo it. */
export const UNDO_MINUTES = 5;

/** Days before the end of the hold window that the customer gets a reminder. */
export const REMINDER_DAYS_BEFORE = 2;

/** Plain names for the statuses, as people see them. */
export const STATUS_LABELS: Record<ParcelStatus, string> = {
  registered: 'Registered',
  ready: 'Ready at the shop',
  in_transit: 'On its way',
  at_point: 'Ready to collect',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

/**
 * Parcel codes: 8 Crockford base32 characters shown as `7K3M-Q9XD`. People type them, so the
 * alphabet leaves out I, L, O and U, and reading normalises lookalikes.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function formatCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/** A typed or scanned code, cleaned up: `7k3m q9xd`, `7K3M-Q9XD` and the label's URL all give
 * `7K3MQ9XD`. */
export function normaliseCode(input: string): string | null {
  const last = input.trim().split('/').filter(Boolean).at(-1) ?? '';
  const raw = last
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(raw) ? raw : null;
}
