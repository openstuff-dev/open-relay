import { STATUS_LABELS, type ParcelStatus, type Role } from '@open-relay/contracts';

export { STATUS_LABELS };

type Tone = 'neutral' | 'brand' | 'danger' | 'warning' | 'success' | 'info';

export const STATUS_TONES: Record<ParcelStatus, Tone> = {
  registered: 'neutral',
  ready: 'info',
  in_transit: 'brand',
  at_point: 'warning',
  collected: 'success',
  cancelled: 'neutral',
};

export const ROLE_LABELS: Record<Role | 'api', string> = {
  admin: 'Admin',
  merchant: 'Shop staff',
  courier: 'Courier',
  point: 'Point staff',
  api: 'Shop API',
};

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "3 Nov, 14:00" in the reader's own language and time zone. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "Tuesday 17 November" */
export function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** `7K3MQ9XD` → `7K3M-Q9XD` */
export const code = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4)}`;
