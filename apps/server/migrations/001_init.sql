-- OpenRelay: parcels from online shops to a pick-up point near the customer.
--
--   networks                     a delivery network (the tenant)
--     ├─ memberships             who signs in: admins, merchant staff, couriers and point staff
--     ├─ merchants               online shops that send parcels, with their API keys
--     ├─ points                  pick-up points where customers collect them
--     ├─ parcels                 one package for one customer, going to one point
--     │    └─ scans              every step of its journey, append-only (undo marks one undone)
--     └─ outbox                  emails to send, written in the same transaction as the step
--
-- Every network table has row-level security: a request only sees the network it was opened
-- for (openrelay.network_id), so a query that forgets its WHERE clause can't leak another one.

CREATE TABLE networks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text NOT NULL DEFAULT '',
  password_hash   text NOT NULL,
  is_server_admin boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TABLE merchants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  slug       text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name       text NOT NULL,
  address    text NOT NULL DEFAULT '',
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, slug)
);

CREATE TABLE points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name          text NOT NULL,
  street        text NOT NULL,
  postcode      text NOT NULL,
  city          text NOT NULL,
  lat           double precision CHECK (lat BETWEEN -90 AND 90),
  lng           double precision CHECK (lng BETWEEN -180 AND 180),
  -- Monday first, free text: "9–17", "closed".
  opening_hours text[] NOT NULL CHECK (cardinality(opening_hours) = 7),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, slug),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

CREATE TYPE member_role AS ENUM ('admin', 'merchant', 'courier', 'point');

CREATE TABLE memberships (
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role        member_role NOT NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  point_id    uuid REFERENCES points(id) ON DELETE CASCADE,
  PRIMARY KEY (network_id, account_id),
  -- Merchant staff belong to one merchant, point staff to one point, nobody else to either.
  CHECK ((role = 'merchant') = (merchant_id IS NOT NULL)),
  CHECK ((role = 'point') = (point_id IS NOT NULL))
);
CREATE INDEX memberships_account ON memberships(account_id);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  merchant_id  uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  hint         text NOT NULL,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The same statuses as STATUSES in @open-relay/contracts.
CREATE TYPE parcel_status AS ENUM ('registered', 'ready', 'in_transit', 'at_point', 'collected', 'cancelled');

CREATE TABLE parcels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  merchant_id       uuid NOT NULL REFERENCES merchants(id),
  point_id          uuid NOT NULL REFERENCES points(id),
  -- The label's code, unique on the whole server so /s/{code} needs no network.
  code              text NOT NULL UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  tracking_token    text NOT NULL UNIQUE,
  -- Only the customer gets it; staff APIs never return it.
  pickup_code       text NOT NULL CHECK (pickup_code ~ '^[0-9]{6}$'),
  reference         text CHECK (length(reference) <= 100),
  status            parcel_status NOT NULL DEFAULT 'registered',
  -- The customer's details, deleted (set to null) after the retention period.
  customer_name     text,
  customer_email    text,
  customer_phone    text,
  customer_street   text,
  customer_postcode text,
  customer_city     text,
  -- Set when the parcel reaches the point; it's overdue there after this.
  hold_until        timestamptz,
  reminded_at       timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('collected', 'cancelled')) = (closed_at IS NOT NULL))
);
CREATE INDEX parcels_list ON parcels(network_id, status, updated_at DESC);
CREATE INDEX parcels_merchant ON parcels(merchant_id, status);
CREATE INDEX parcels_point ON parcels(point_id, status);

CREATE TABLE scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  parcel_id   uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  from_status parcel_status,
  to_status   parcel_status NOT NULL,
  -- A member role, or 'api' for a merchant's API key.
  role        text NOT NULL,
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Kept as text, so the history still reads right after the account is gone.
  by_name     text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);
CREATE INDEX scans_parcel ON scans(parcel_id, at);

CREATE TABLE outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  parcel_id  uuid REFERENCES parcels(id) ON DELETE CASCADE,
  -- Undoing a scan drops the emails it queued that haven't gone out.
  scan_id    uuid REFERENCES scans(id) ON DELETE CASCADE,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  text_body  text NOT NULL,
  html_body  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  last_error text,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox(send_after) WHERE sent_at IS NULL;

-- Row-level security ------------------------------------------------------------------------

CREATE FUNCTION openrelay_network() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('openrelay.network_id', true), '')::uuid $$;
CREATE FUNCTION openrelay_bypass() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('openrelay.bypass', true), '') = 'on' $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['merchants', 'points', 'api_keys', 'parcels', 'scans', 'outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY network_isolation ON %I
      USING (openrelay_bypass() OR network_id = openrelay_network())
      WITH CHECK (openrelay_bypass() OR network_id = openrelay_network())', t);
  END LOOP;
END $$;

-- The role every request runs as. Superusers skip row-level security, so the server switches
-- to this role on each connection (see createPool in src/db.ts).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrelay_app') THEN
    CREATE ROLE openrelay_app NOLOGIN;
  END IF;
END $$;
