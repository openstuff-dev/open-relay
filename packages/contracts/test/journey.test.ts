import { describe, expect, it } from 'vitest';
import { canCancel, formatCode, nextStatus, normaliseCode, type ParcelStatus, type Role } from '../src/journey.js';

describe('nextStatus', () => {
  const allowed: [Role, ParcelStatus, ParcelStatus][] = [
    ['merchant', 'registered', 'ready'],
    ['courier', 'ready', 'in_transit'],
    ['point', 'in_transit', 'at_point'],
    ['point', 'at_point', 'collected'],
  ];

  it.each(allowed)('lets %s move %s to %s', (role, from, to) => {
    expect(nextStatus(role, from)).toEqual({ ok: true, to });
    expect(nextStatus('admin', from)).toEqual({ ok: true, to });
  });

  it('refuses every other role and status', () => {
    const roles: Role[] = ['merchant', 'courier', 'point'];
    const statuses: ParcelStatus[] = ['registered', 'ready', 'in_transit', 'at_point', 'collected', 'cancelled'];
    for (const role of roles) {
      for (const status of statuses) {
        if (allowed.some(([r, s]) => r === role && s === status)) continue;
        const outcome = nextStatus(role, status);
        expect(outcome.ok, `${role} on ${status}`).toBe(false);
      }
    }
  });

  it('says why in plain words', () => {
    expect(nextStatus('courier', 'registered')).toEqual({
      ok: false,
      reason: 'The shop hasn’t marked this parcel ready yet.',
    });
    expect(nextStatus('admin', 'collected')).toEqual({
      ok: false,
      reason: 'This parcel has already been collected.',
    });
  });

  it('allows cancelling until a courier has the parcel', () => {
    expect(canCancel('registered')).toBe(true);
    expect(canCancel('ready')).toBe(true);
    expect(canCancel('in_transit')).toBe(false);
  });
});

describe('parcel codes', () => {
  it('reads typed, scanned and label-URL codes', () => {
    expect(normaliseCode('7K3M-Q9XD')).toBe('7K3MQ9XD');
    expect(normaliseCode(' 7k3m q9xd ')).toBe('7K3MQ9XD');
    expect(normaliseCode('https://relay.example.com/s/7K3M-Q9XD')).toBe('7K3MQ9XD');
    expect(normaliseCode('7K3M-Q9XO')).toBe('7K3MQ9X0');
    expect(normaliseCode('7K3M-Q9XU')).toBeNull();
    expect(normaliseCode('short')).toBeNull();
  });

  it('formats codes in two groups', () => {
    expect(formatCode('7K3MQ9XD')).toBe('7K3M-Q9XD');
  });
});
