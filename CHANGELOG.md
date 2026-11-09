# Changelog

Each release is a Docker image at `ghcr.io/openstuff-dev/open-relay:<version>`.
Migrations run when the new version starts and only move forward, so back up first.

## 0.2.0

Migrations `002_server_integrations` and `003_deploy_token` add the server's connections table.
Back up first.

### Web app

- Settings is one page with tabs: Account, Appearance, Members, API keys, Export and import, and
  Networks for server admins. The old addresses take you to the right tab. One-time passwords and keys
  open in a dialog you can't miss.
- New Integrations tab for server admins: paste a connection string from OpenVersion or OpenAnnounce
  and see straight away whether it works and how to fix it. Each connection can be tested, changed
  or removed.
- With OpenVersion connected, open tabs offer to reload when a new version is live.
- With OpenAnnounce connected, messages show for the network and role someone is in. The card lists
  the groups to create in OpenAnnounce.
- Moved onto `@openstuff-dev/ui` and `ui-angular` 0.1.8.

### Server

- With an OpenVersion deploy token saved, the server publishes its own version on start.
- New settings: `OPENRELAY_SECRET_KEY` encrypts the saved keys. Without it, a key is made and kept in
  the database, with a warning in the log. Set it before connecting anything, because changing it
  later means entering the keys again. `OPENRELAY_FETCH` and `OPENRELAY_FETCH_ALLOW` control which
  addresses a connection may reach. `OPENRELAY_OPENVERSION_*` and `OPENRELAY_OPENANNOUNCE_*` set a
  connection from the environment, and its card becomes read only.
- Saved connection secrets never leave the server: not in the admin list, not in an export.

### Image

- The image carries its own version (`VERSION` build arg), so the server reports it and the web app
  knows it.

## 0.1.1

No migrations.

- A missing file now answers 404 instead of the web app, so a tab on an old build recovers instead of showing a blank page.
- The first admin's log line now points to Settings, where the password is changed.
- Moved onto `@openstuff-dev/ui` and `ui-angular` 0.1.6.

## 0.1.0

The first release with a published image.
