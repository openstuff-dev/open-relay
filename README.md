# Open Relay

An OpenStuff project, built on the OpenStuff toolkit (`@openstuff-dev/ui`, `@openstuff-dev/tokens`
and `@openstuff-dev/lint`).

## Develop

```sh
npm install
npx nx serve web       # http://localhost:4200
npx nx dev server       # the API on http://localhost:8080; the web app sends /api there
```

Before you push, run what CI runs:

```sh
npx nx run-many -t lint stylelint typecheck test build
```

## Run it with Docker

```sh
cp .env.example .env
docker compose up --build
```

It's on http://localhost:8080.

## Theme

Every colour, light and dark, is generated from one `primaryColor` in
`apps/web/tokens.config.json`. Change it and rebuild.

## Layout

| Folder | What's in it |
|---|---|
| `apps/web` | The Angular web app |
| `apps/server` | The Fastify API, which also serves the web app in production |
| `packages/` | Shared and published packages (`npx nx g @openstuff-dev/nx:library <name>`) |

New Angular components: `npx nx g @openstuff-dev/nx:component <name>`. To pick up newer shared
files and toolkit versions: `npx nx g @openstuff-dev/nx:sync`.

## Agents

`AGENTS.md` (and `CLAUDE.md`) tell coding agents how to work here and how to use
[OpenPurpose](https://github.com/openstuff-dev/open-purpose) for shared rules.

## Licence

MIT
