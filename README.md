# OpenRelay

Parcels from online shops to a pick-up point near the customer, with every hand-off scanned and
the customer kept informed.

Project page: https://relay.openstuff.dev

A delivery network runs OpenRelay with its shops, couriers and pick-up points. Each parcel gets
one label with one QR code. Whoever handles the parcel next scans it, and OpenRelay works out the
step from who they are:

| Step | Who | How | The customer gets |
|---|---|---|---|
| Registered | The shop | A form, a CSV file or the API | “On its way to {point}” and a tracking link |
| Ready at the shop | Shop staff | Scan the label | — (couriers see it in their pickups) |
| On its way | Courier | Scan the label at the shop | “Out for delivery” |
| Ready to collect | Point staff | Scan the label on arrival | “Ready to collect”, with a 6-digit pickup code |
| Collected | Point staff | Scan the label and the customer’s pickup code | A receipt |

A scan that doesn’t fit says why (“This parcel goes to Station Kiosk, not here”), and the person
who made a scan can undo it for 5 minutes. Customers don’t need an account: they follow the
parcel on its tracking page and show their pickup code at the counter.

## Who does what

- **Server admins** add networks, each kept apart from the others with Postgres row-level
  security.
- **Admins** of a network add shops, pick-up points, members and API keys.
- **Shop staff** add parcels for their shop, print labels and mark parcels ready.
- **Couriers** see which shops have parcels ready and scan them as they take them.
- **Point staff** receive parcels at their point and hand them over.
- **Customers** follow their parcel and collect it with their pickup code.

## Try it

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs app | grep "first admin"   # the admin's password, shown once
```

Open http://localhost:8080 and sign in. To try it with a demo network (two shops, three points,
one member per role and parcels at every step):

```sh
docker compose exec app node dist/seed-demo.js
```

It prints the demo members’ emails and passwords. Sign in as the shop, the courier and the point
in turn and scan a parcel through. To read the customers’ emails in a browser, set
`OPENRELAY_SMTP_URL=smtp://mailpit:1025` in `.env`, run `docker compose --profile mail up -d`,
and open http://localhost:8025.

## Scanning

The scan page works on a phone. **Use the camera** reads QR codes (on a phone, the browser only
allows the camera over `https://`). A USB or Bluetooth handheld scanner works too: it types the
code into the parcel code field and presses Enter. People can also type the code under the QR
code (`7K3M-Q9XD`); case, spaces and dashes don’t matter.

Opening a label’s QR code with any phone camera goes to `/s/{code}`: signed-in staff land on
their scan page with the parcel scanned, and anyone else gets the sign-in page and sees nothing.

## Add parcels from a shop’s system

An admin makes an API key for the shop under **API keys**. It’s shown once.

```sh
# The pick-up points nearest the customer, for the checkout
curl "https://relay.example.com/api/v1/points?postcode=2200&city=Copenhagen" \
  -H "Authorization: Bearer rk_…"

# Add a parcel: the customer gets the first email at once
curl https://relay.example.com/api/v1/parcels \
  -H "Authorization: Bearer rk_…" -H "Content-Type: application/json" \
  -d '{"pointId": "…", "reference": "#1042",
       "customer": {"name": "Mia Jensen", "email": "mia@example.com", "postcode": "2200"}}'

# Read it back, by its parcel code
curl https://relay.example.com/api/v1/parcels/7K3M-Q9XD -H "Authorization: Bearer rk_…"
```

A key only sees its own shop’s parcels. Plugins for Shopify, WooCommerce and Wix will build on
this API.

Shops without a system import a CSV file under **Parcels → Import CSV**. The first row names the
columns: `name` and `email` are required; `phone`, `street`, `postcode`, `city`, `reference` and
`point` are optional. Without a point, the nearest one is picked.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgres://openrelay:openrelay@localhost:5432/openrelay` | The Postgres database. Compose sets it. |
| `POSTGRES_PASSWORD` | `openrelay` | The database password compose uses. Change it on a server. |
| `PORT` | `8080` | The port on this machine. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `OPENRELAY_PUBLIC_URL` | `http://localhost:8080` | Where people reach OpenRelay. Label QR codes and email links point here, so set it before printing labels. Cookies are `Secure` when it’s `https://`, and changes posted from other origins are refused. |
| `OPENRELAY_ADMIN_EMAIL` | `admin@example.com` | The first server admin, made on the first start. |
| `OPENRELAY_ADMIN_PASSWORD` | _(made and logged once)_ | That admin’s password. |
| `OPENRELAY_SESSION_DAYS` | `30` | How long people stay signed in. |
| `OPENRELAY_SMTP_URL` | _(none: emails go to the log)_ | Where customers’ emails are sent, e.g. `smtps://user:pass@smtp.example.com:465`. |
| `OPENRELAY_MAIL_FROM` | `OpenRelay <noreply@localhost>` | The sender of those emails. |
| `OPENRELAY_HOLD_DAYS` | `14` | How long a parcel waits at the point before it’s overdue. Customers get a reminder 2 days before. |
| `OPENRELAY_RETENTION_DAYS` | `90` | How long after a parcel is collected or cancelled the customer’s details are kept. |
| `OPENRELAY_GEOCODER_URL` | _(off)_ | A Nominatim-compatible geocoder, to sort points by distance. Without it, points are matched by postcode. |
| `OPENRELAY_TRUST_PROXY` | _(off)_ | Behind a reverse proxy: `true`, or the proxy’s addresses, so rate limits see real client addresses. |
| `OPENRELAY_SECRET_KEY` | _(made and kept in the database, with a warning)_ | Encrypts the saved connection secrets (OpenAnnounce's signing secret). Set it on a real server, so a database dump alone can’t reveal them. Changing it makes saved secrets unreadable: enter them again. |
| `OPENRELAY_OPENVERSION_URL` | _(off)_ | The OpenVersion this server checks releases against, e.g. `https://versions.example.com`. Setting it (with the public key) wins over the Integrations tab, which then shows the connection read-only. |
| `OPENRELAY_OPENVERSION_PUBLIC_KEY` | _(off)_ | That OpenVersion app’s public key (`pk_…`). Safe in browser code. |
| `OPENRELAY_OPENANNOUNCE_URL` | _(off)_ | The OpenAnnounce that shows messages in this app, e.g. `https://news.example.com`. Wins over the Integrations tab, as above. |
| `OPENRELAY_OPENANNOUNCE_PUBLIC_KEY` | _(off)_ | That OpenAnnounce system’s public key. |
| `OPENRELAY_OPENANNOUNCE_SIGNING_SECRET` | _(off)_ | Signs each person’s token, so messages can be aimed at a tenant or role. For this server only, never in browser code. |
| `OPENRELAY_FETCH` | `public` | `private` lets this server call internal addresses, such as an OpenVersion on your network. Public refuses them. |
| `OPENRELAY_FETCH_ALLOW` | _(any)_ | With `private`: a comma-separated list of hosts allowed to be internal, e.g. `versions.internal,news.internal`. |

**Security and privacy.** The database user may be a superuser (the Docker default): every
connection drops to the `openrelay_app` role, which row-level security applies to. If it can’t,
the server refuses to start. Only the customer gets the pickup code; staff never see it, and 5
wrong tries lock a parcel for 15 minutes. API keys are stored hashed. The customer’s details are
deleted after `OPENRELAY_RETENTION_DAYS`, and only the scan history stays. When
`OPENRELAY_GEOCODER_URL` is set, customers’ addresses are sent to that geocoder: run your own, or
pick one whose terms you accept.

Admins can export a network to one JSON file and import it on another server under **Export and
import**.

## Develop

```sh
npm install
docker run -d --name openrelay-db -e POSTGRES_USER=openrelay \
  -e POSTGRES_PASSWORD=openrelay -e POSTGRES_DB=openrelay -p 5432:5432 postgres:16-alpine
npx nx dev server       # the API on http://localhost:8080
npx nx serve web        # the app on http://localhost:4200; /api goes to the server
npx tsx apps/server/src/seed-demo.ts   # optional: the demo network
```

Before you push, run what CI runs. The server’s tests need a database, which they empty first:

```sh
docker exec openrelay-db psql -U openrelay -c 'CREATE DATABASE openrelay_test'
TEST_DATABASE_URL=postgres://openrelay:openrelay@localhost:5432/openrelay_test \
  npx nx run-many -t lint stylelint typecheck test build
```

Without `TEST_DATABASE_URL` those tests are skipped.

## Layout

| Folder | What’s in it |
|---|---|
| `apps/web` | The app (Angular, on the OpenStuff toolkit): admin pages, the scan page, pickups and the customer’s tracking page |
| `apps/server` | The Fastify API, the merchant API, labels, the email worker, the migrations and the demo seed. In production it also serves the app |
| `site` | The project page at relay.openstuff.dev: plain HTML on the OpenStuff toolkit, published by `.github/workflows/pages.yml` |
| `packages/contracts` | `@open-relay/contracts`: the API’s types and the parcel journey (`nextStatus`), shared by both |

## License

MIT
