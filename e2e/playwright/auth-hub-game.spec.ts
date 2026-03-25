import { expect, test, type Page } from '@playwright/test';

const e2eBaseUrl = (process.env.E2E_BASE_URL || '').trim();

const mockUser = {
  id: 'e2e-user-1',
  name: 'Gardener E2E',
  email: 'gardener.e2e@example.com',
  picture: 'https://example.com/avatar.png',
  isAdmin: false,
};

const mockBootstrapPayload = {
  platform: {
    name: 'Garden Quest Platform',
    hubPath: '/hub.html',
    loginPath: '/index.html',
  },
  user: mockUser,
  games: [
    {
      slug: 'garden-quest',
      name: 'Garden Quest',
      status: 'active',
      route: '/games/garden-quest/',
      tagline: 'E2E smoke flow',
      description: 'Game card used in Playwright smoke test',
      capabilities: ['multiplayer', 'chat'],
      accentColor: '#38bd7e',
      surfaceColor: '#10261b',
      artworkLabel: 'GQ',
    },
  ],
};

function appUrl(pathname: string): string {
  return new URL(pathname, e2eBaseUrl).toString();
}

async function mockAuthorizedPlatform(page: Page): Promise<void> {
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });

  await page.route('**/api/v1/platform/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockBootstrapPayload),
    });
  });

  await page.route('**/api/v1/platform/events', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ tracked: true }),
    });
  });
}

async function stubGameLoader(page: Page): Promise<void> {
  await page.route('**/games/garden-quest/js/game-loader.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        const loading = document.getElementById('loadingScreen');
        if (loading) loading.style.display = 'none';
        window.__E2E_GAME_LOADER_STUB__ = true;
      `,
    });
  });
}

test.describe('Platform auth -> hub -> game smoke flow', () => {
  test.skip(!e2eBaseUrl, 'Set E2E_BASE_URL to a running frontend URL (ex: http://127.0.0.1:5500).');

  test('index redirects authenticated user to hub and renders catalog', async ({ page }) => {
    await mockAuthorizedPlatform(page);

    await page.goto(appUrl('/index.html'));

    await expect(page).toHaveURL(/\/hub\.html/);
    await expect(page.locator('#hubUserName')).toContainText('Gardener E2E');
    await expect(page.locator('.game-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Abrir jogo/i })).toBeVisible();
  });

  test('hub redirects to login endpoint when bootstrap returns 401', async ({ page }) => {
    await page.route('**/api/v1/platform/bootstrap', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid, expired, or revoked session' }),
      });
    });

    await page.route('**/auth/google**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>mock oauth redirect endpoint</body></html>',
      });
    });

    await page.goto(appUrl('/hub.html'));

    await page.waitForURL(/\/auth\/google\?/);
  });

  test('hub launches garden quest route', async ({ page }) => {
    await mockAuthorizedPlatform(page);
    await stubGameLoader(page);

    await page.goto(appUrl('/hub.html'));
    await expect(page.getByRole('button', { name: /Abrir jogo/i })).toBeVisible();

    await page.getByRole('button', { name: /Abrir jogo/i }).click();

    await expect(page).toHaveURL(/\/games\/garden-quest\/(\?.*)?$/);
    await expect(page.locator('#gameCanvas')).toBeVisible();
    await expect(page.locator('#hubBtn')).toBeVisible();
  });
});
