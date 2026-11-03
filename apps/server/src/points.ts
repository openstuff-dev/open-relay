import type { SuggestedPoint } from '@open-relay/contracts';
import type { Config } from './config.js';
import type { Client } from './db.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Address {
  street?: string;
  postcode?: string;
  city?: string;
}

/**
 * Coordinates for an address from the geocoder in OPENRELAY_GEOCODER_URL (Nominatim's
 * /search), or null without one or when it doesn't answer in 3 seconds. The URL is the server
 * owner's own setting, never one a user gives.
 */
export async function geocode(config: Config, address: Address): Promise<LatLng | null> {
  if (!config.geocoderUrl) return null;
  const q = [address.street, `${address.postcode ?? ''} ${address.city ?? ''}`.trim()]
    .filter(Boolean)
    .join(', ');
  if (!q) return null;
  try {
    const url = `${config.geocoderUrl}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OpenRelay (self-hosted)', Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const hit = ((await response.json()) as { lat: string; lon: string }[]).at(0);
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

/** Kilometres between two points on the earth, as the crow flies. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const clean = (s = '') => s.toLowerCase().replace(/\s+/g, '');

/** How many leading characters two postcodes share: 2100 and 2150 share 2. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * The active points nearest an address, at most `limit`. With a geocoder and coordinates, by
 * distance; otherwise the same postcode first, then postcodes that start alike, then the city.
 */
export async function suggestPoints(
  db: Client,
  config: Config,
  address: Address,
  limit = 5,
): Promise<SuggestedPoint[]> {
  const [{ rows }, here] = await Promise.all([
    db.query<SuggestedPoint & { lat: number | null; lng: number | null }>(
      `SELECT id, name, street, postcode, city, lat, lng FROM points WHERE active ORDER BY name`,
    ),
    geocode(config, address),
  ]);
  const postcode = clean(address.postcode);
  const city = clean(address.city);
  const scored = rows.map((p) => {
    const distance = here && p.lat !== null && p.lng !== null ? distanceKm(here, p as never) : null;
    const prefix = sharedPrefix(postcode, clean(p.postcode));
    const sameCity = city !== '' && clean(p.city) === city;
    return { p, distance, score: [distance ?? Infinity, -prefix, sameCity ? 0 : 1] };
  });
  scored.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    }
    return 0;
  });
  return scored.slice(0, limit).map(({ p, distance }) => ({
    id: p.id,
    name: p.name,
    street: p.street,
    postcode: p.postcode,
    city: p.city,
    distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
  }));
}
