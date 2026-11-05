# Changelog

Each release is a Docker image at `ghcr.io/openstuff-dev/open-relay:<version>`.
Migrations run when the new version starts and only move forward, so back up first.

## 0.1.1

No migrations.

- A missing file now answers 404 instead of the web app, so a tab on an old build recovers instead of showing a blank page.
- The first admin's log line now points to Settings, where the password is changed.
- Moved onto `@openstuff-dev/ui` and `ui-angular` 0.1.6.

## 0.1.0

The first release with a published image.
