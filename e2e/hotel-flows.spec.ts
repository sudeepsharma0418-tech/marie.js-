import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Pass-2083!';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/Email|इमेल/).fill(email);
  await page.getByLabel(/^Password|^पासवर्ड/).fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in|साइन इन/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Namaste|नमस्ते/);
}

test('hotel manager orders from the catalog in Nepali', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for this flow');
  await login(page, 'manager@lumbini.demo.local');
  await page.getByRole('button', { name: 'नेपाली' }).first().click();
  await page.getByRole('link', { name: 'सामान सूची' }).click();
  await expect(page.getByRole('heading', { name: 'सामान अर्डर गर्नुहोस्' })).toBeVisible();
  await page.getByPlaceholder('नाम, SKU वा ब्रान्डबाट खोज्नुहोस्').fill('CL-GLS');
  const card = page.locator('div.rounded-xl', { hasText: 'सिसा सफा गर्ने झोल' }).first();
  await card.getByLabel('परिमाण').fill('6');
  await card.getByRole('button', { name: 'थप्नुहोस्' }).click();
  await page.getByRole('button', { name: /कार्ट/ }).first().click();
  await page.getByRole('button', { name: 'अर्डर पेस गर्नुहोस्' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('अर्डर ORD-');
  await expect(page.getByText('स्वीकृत').first()).toBeVisible();
  // costs never appear in the hotel's view
  await expect(page.getByText(/सन्दर्भ लागत|Reference cost/)).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/order-nepali.png', fullPage: true });
});

test('store keeper records shelf usage online and offline, then syncs without duplicates', async ({
  page,
  context,
  request,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'the QR workflow is designed for phones');
  await login(page, 'store@tinau.demo.local');
  await page.getByRole('main').getByRole('link', { name: 'Scan shelf' }).click();
  await page.getByRole('link', { name: /HK shelf A/ }).click();
  await expect(page.getByRole('heading', { name: 'HK shelf A – toiletries' })).toBeVisible();

  // online usage: default usage quantity is pre-filled (2)
  await page.getByRole('button', { name: /Guest shampoo 30 ml/ }).click();
  await expect(page.getByLabel('Quantity')).toHaveValue('2');
  await page.getByRole('button', { name: /Save: Used/ }).click();
  await expect(page.getByText('Saved. Shelf now has 118.')).toBeVisible();

  // offline: two more entries are stored on the device
  await context.setOffline(true);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /Guest shampoo 30 ml/ }).click();
    await page.getByRole('button', { name: /Save: Used/ }).click();
    await expect(page.getByText(/Saved on this device/)).toBeVisible();
  }
  await expect(page.getByText(/2 entries are waiting to sync/)).toBeVisible();
  await expect(page.getByText('114').first()).toBeVisible(); // 118 - 2 - 2, shown locally
  await page.screenshot({ path: 'e2e/screenshots/scan-offline.png', fullPage: true });

  // back online: the outbox syncs automatically
  await context.setOffline(false);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 20_000 });

  // the server has exactly three usage movements of 2 (no duplicates)
  const api = await request.post('http://localhost:4000/api/v1/auth/login', {
    data: { email: 'manager@tinau.demo.local', password: PASSWORD },
  });
  expect(api.ok()).toBeTruthy();
  const events = await (
    await request.get('http://localhost:4000/api/v1/hotel-inventory/events?limit=50')
  ).json();
  const usage = events.items.filter((e: any) => e.nameEn === 'Guest shampoo 30 ml' && e.action === 'usage');
  expect(usage).toHaveLength(3);
  expect(usage.filter((e: any) => e.source === 'offline_sync')).toHaveLength(2);
  const scan = await page.request.get(
    'http://localhost:5173/api/v1/hotel-inventory/scan/' + page.url().split('/scan/')[1],
  );
  const body = await scan.json();
  expect(body.products.find((p: any) => p.nameEn === 'Guest shampoo 30 ml').balance).toBe('114.000');
});

test('owner sees the dashboard and approvals; hub staff cannot open finance pages', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  await login(page, 'owner@demo.local');
  await expect(page.getByText('Pending approvals')).toBeVisible();
  await page.getByRole('link', { name: 'Approvals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/owner-approvals.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'hub@demo.local');
  await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0);
  await page.goto('/invoices');
  await expect(page.getByText('You do not have permission to view this.')).toBeVisible();
});
