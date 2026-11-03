import type { ParcelStatus, Role } from './journey.js';

export * from './journey.js';

export interface Me {
  id: string;
  email: string;
  name: string;
  isServerAdmin: boolean;
  networks: MyNetwork[];
}

/** A network the account is a member of, and what it does there. */
export interface MyNetwork {
  slug: string;
  name: string;
  role: Role;
  /** Set for merchant staff. */
  merchantId: string | null;
  /** Set for point staff. */
  pointId: string | null;
}

export interface Network {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface Member {
  accountId: string;
  email: string;
  name: string;
  role: Role;
  merchantId: string | null;
  pointId: string | null;
}

/** Returned once, when an account is made for a new member. */
export interface NewMember extends Member {
  password: string | null;
}

export interface MemberInput {
  email: string;
  name?: string;
  role: Role;
  merchantId?: string | null;
  pointId?: string | null;
}

export interface Merchant {
  id: string;
  slug: string;
  name: string;
  /** Where couriers pick parcels up. */
  address: string;
  email: string | null;
  parcelCount: number;
}

export interface MerchantInput {
  name: string;
  address: string;
  email?: string | null;
}

/** Opening hours per weekday, Monday first, as free text: "9–17", "closed". */
export type OpeningHours = [string, string, string, string, string, string, string];

export interface Point {
  id: string;
  slug: string;
  name: string;
  street: string;
  postcode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  openingHours: OpeningHours;
  active: boolean;
  /** Parcels there now, waiting for their customers. */
  waiting: number;
}

export interface PointInput {
  name: string;
  street: string;
  postcode: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  openingHours: OpeningHours;
  active?: boolean;
}

/** A point suggested for a customer's address; `distanceKm` is null without coordinates. */
export interface SuggestedPoint {
  id: string;
  name: string;
  street: string;
  postcode: string;
  city: string;
  distanceKm: number | null;
}

export interface Customer {
  name: string;
  email: string;
  phone: string | null;
  street: string;
  postcode: string;
  city: string;
}

export interface ParcelInput {
  merchantId: string;
  pointId: string;
  /** The shop's own order number, e.g. "#1042". */
  reference?: string | null;
  customer: Customer;
}

/** What a shop sends through the API: the merchant comes from its key. */
export type ApiParcelInput = Omit<ParcelInput, 'merchantId'>;

export interface ParcelRow {
  id: string;
  code: string;
  reference: string | null;
  status: ParcelStatus;
  merchant: { id: string; name: string };
  point: { id: string; name: string };
  /** Null once the customer's details were deleted. */
  customerName: string | null;
  holdUntil: string | null;
  overdue: boolean;
  updatedAt: string;
}

export interface Scan {
  id: string;
  from: ParcelStatus | null;
  to: ParcelStatus;
  role: Role | 'api';
  by: string;
  at: string;
  undoneAt: string | null;
}

export interface Parcel extends ParcelRow {
  /** Null once the customer's details were deleted. */
  customer: Customer | null;
  /** For admins and the shop, to share with the customer; null for others. */
  trackingUrl: string | null;
  createdAt: string;
  scans: Scan[];
}

/** The parcels page in one request: a page of parcels and what the filters offer. */
export interface ParcelsPage {
  parcels: ParcelRow[];
  total: number;
  merchants: { id: string; name: string }[];
  points: { id: string; name: string }[];
}

export interface ScanInput {
  code: string;
  /** Needed to hand a parcel over: the 6-digit code from the customer's email or its QR. */
  pickupCode?: string;
}

export interface ScanResult {
  scanId: string;
  parcel: ParcelRow;
  from: ParcelStatus;
  to: ParcelStatus;
  /** Until when the person who scanned may undo it. */
  undoUntil: string;
}

/** A scan the server refused, with what to tell the person holding the parcel. */
export interface ScanRefused {
  error: string;
  parcel?: ParcelRow;
  /** True when the scan would work with the customer's pickup code. */
  needsPickupCode?: boolean;
}

/** The courier's pickup list: ready parcels, by shop. */
export interface PickupStop {
  merchant: { id: string; name: string; address: string };
  parcels: { id: string; code: string; point: string }[];
}

export interface CsvImportResult {
  created: number;
  /** Rows that couldn't be added, 1-based, with why. */
  errors: { row: number; error: string }[];
}

export interface ApiKey {
  id: string;
  name: string;
  merchantId: string;
  merchantName: string;
  hint: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Returned once, when a key is made. */
export interface NewApiKey extends ApiKey {
  key: string;
}

/** The customer's tracking page: no names of staff, no other parcels. */
export interface Tracking {
  code: string;
  status: ParcelStatus;
  merchant: string;
  reference: string | null;
  point: {
    name: string;
    street: string;
    postcode: string;
    city: string;
    openingHours: OpeningHours;
  };
  holdUntil: string | null;
  /** Shown once the parcel is at the point and not collected yet. */
  pickupCode: string | null;
  steps: { status: ParcelStatus; at: string }[];
}

/** Everything a network holds, without customer data of collected parcels or secrets. */
export interface NetworkExport {
  format: 'openrelay-export';
  version: 1;
  exportedAt: string;
  network: { slug: string; name: string };
  merchants: (MerchantInput & { slug: string })[];
  points: (PointInput & { slug: string })[];
  parcels: {
    code: string;
    merchant: string;
    point: string;
    reference: string | null;
    status: ParcelStatus;
    customer: Customer | null;
    holdUntil: string | null;
    createdAt: string;
    updatedAt: string;
    scans: { from: ParcelStatus | null; to: ParcelStatus; role: Role | 'api'; by: string; at: string }[];
  }[];
}

export interface ApiError {
  error: string;
}
