/// <reference types="node" />
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 18120;
const databaseUrl = process.env['E2E_DATABASE_URL'] ?? '';

// Same guard as the server's integration tests: this creates an admin in whatever database it gets.
if (!/\/[^/]*_e2e(\?.*)?$/.test(databaseUrl)) {
  throw new Error('Set E2E_DATABASE_URL to a throwaway database whose name ends in _e2e.');
}

/** Where the server runs; also the origin the app's own requests come from. */
export const baseURL = `http://127.0.0.1:${port}`;

export const admin = { email: 'admin@e2e.test', password: 'e2e-admin-password-0123' };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['junit', { outputFile: 'e2e-results.xml' }]],
  outputDir: 'e2e-output',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    channel: process.env['E2E_CHROME_CHANNEL'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../server/dist/index.js',
    url: `${baseURL}/`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      DATABASE_URL: databaseUrl,
      OPENRELAY_ADMIN_EMAIL: admin.email,
      OPENRELAY_ADMIN_PASSWORD: admin.password,
      OPENRELAY_PUBLIC_URL: baseURL,
      WEB_DIR: resolve(__dirname, 'dist/web/browser'),
    },
  },
});
