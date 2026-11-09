import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { admin, baseURL } from '../playwright.config';

const unique = (name: string): string => `${name} ${Date.now()}-${test.info().parallelIndex}-${randomUUID().slice(0, 4)}`;

/** Calls the API as the signed-in page, from the app's own origin, as the app does. */
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: { origin: baseURL, 'idempotency-key': randomUUID() },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Signs in as the server admin and makes a new network, so every test starts empty. */
async function freshNetwork(page: Page): Promise<string> {
  await post(page, '/api/session', admin);
  const network = await post<{ slug: string }>(page, '/api/networks', { name: unique('Network') });
  return network.slug;
}

async function addShop(page: Page, network: string): Promise<{ id: string; name: string }> {
  return post(page, `/api/n/${network}/merchants`, { name: unique('Shop') });
}

const tab = (network: string, id: string): string => `/n/${network}/settings/${id}`;

/** Records whether a skeleton ever appeared, from before the app starts. */
async function watchForSkeleton(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = (): void => {
      if (document.querySelector('os-skeleton')) (window as unknown as { sawSkeleton: boolean }).sawSkeleton = true;
    };
    new MutationObserver(seen).observe(document, { childList: true, subtree: true });
  });
}

const sawSkeleton = (page: Page): Promise<boolean> =>
  page.evaluate(() => Boolean((window as unknown as { sawSkeleton?: boolean }).sawSkeleton));

test.describe('Every Settings tab says what it is for', () => {
  test('UC-4/S1 each tab explains itself', async ({ page }) => {
    const network = await freshNetwork(page);
    await page.goto(tab(network, 'account'));
    const links = page.getByRole('navigation', { name: 'Settings' }).getByRole('link');
    await expect(links.first()).toBeVisible();
    const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(7);
    for (const href of hrefs) {
      await page.goto(href);
      const explainer = page.locator('header[os-section-header] p').first();
      await expect(explainer, href).toBeVisible();
      expect((await explainer.innerText()).split(' ').length, href).toBeGreaterThan(5);
    }
  });

  test('UC-4/S2 no API keys yet offers to make one', async ({ page }) => {
    const network = await freshNetwork(page);
    await addShop(page, network);
    await page.goto(tab(network, 'api-keys'));
    const empty = page.locator('os-empty-state');
    await expect(empty).toContainText('No keys yet');
    await expect(empty).toContainText('add parcels');
    await empty.getByRole('button', { name: 'Make key' }).click();
    await expect(page.getByLabel('Name')).toBeFocused();
  });

  test('UC-4/S3 no shops yet says to add one first', async ({ page }) => {
    const network = await freshNetwork(page);
    await page.goto(tab(network, 'api-keys'));
    const empty = page.locator('os-empty-state');
    await expect(empty).toContainText('A key belongs to a shop, so add a shop first.');
    await empty.getByRole('link', { name: 'Add a shop' }).click();
    await expect(page).toHaveURL(new RegExp(`/n/${network}/merchants$`));
  });

  test('UC-4/S4 a slow tab shows a placeholder, a fast one does not flash', async ({ page }) => {
    const network = await freshNetwork(page);
    await addShop(page, network);
    await watchForSkeleton(page);

    await page.goto(tab(network, 'api-keys'));
    await expect(page.locator('os-empty-state')).toBeVisible();
    expect(await sawSkeleton(page)).toBe(false);

    await page.route('**/api/n/*/api-keys', async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    await page.reload();
    await expect(page.locator('os-skeleton')).toBeVisible();
    await expect(page.locator('os-empty-state')).toBeVisible();
    await expect(page.locator('os-skeleton')).toBeHidden();
  });

  test('UC-4/S5 a tab that cannot load says what failed', async ({ page }) => {
    const network = await freshNetwork(page);
    await page.route('**/api/n/*/{members,api-keys}', (route) =>
      route.fulfill({ status: 503, json: { error: 'The server is down for a moment.' } }),
    );
    await page.goto(tab(network, 'members'));
    await expect(page.locator('os-callout[tone=danger]')).toContainText('The members didn’t load');
    await page.goto(tab(network, 'api-keys'));
    await expect(page.locator('os-callout[tone=danger]')).toContainText('The API keys didn’t load');
  });

  test('UC-4/S6 removing a member or deleting a key says what stops and what stays', async ({ page }) => {
    const network = await freshNetwork(page);
    const shop = await addShop(page, network);
    await post(page, `/api/n/${network}/members`, {
      email: `${randomUUID()}@e2e.test`,
      name: 'Casey Courier',
      role: 'courier',
      merchantId: null,
      pointId: null,
    });
    await post(page, `/api/n/${network}/api-keys`, { name: 'Webshop', merchantId: shop.id });
    const dialog = page.locator('os-confirm-dialog dialog');

    await page.goto(tab(network, 'members'));
    await page.getByRole('row', { name: /Casey Courier/ }).getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toContainText('lose access');
    await expect(dialog).toContainText('Their account stays');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto(tab(network, 'api-keys'));
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toContainText('can’t add or read parcels');
    await expect(dialog).toContainText('Parcels it already added stay');
  });
});
