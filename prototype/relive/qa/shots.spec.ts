import { expect, test } from '@playwright/test';

const POSES = ['overview', 'lausanne', 'montreux', 'climb', 'summit', 'close'] as const;
const world = process.env.RELIVE_WORLD ?? 'google3d';
const prefix =
  world === 'google3d' ? 'google3d-' : world === 'cesium' ? 'cesium-' : '';

for (const pose of POSES) {
  test(`pose: ${world}/${pose}`, async ({ page }) => {
    await page.goto(`/?world=${world}&pose=${pose}&freeze=1&ui=0`);
    await page.waitForFunction(
      () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
      null,
      { timeout: 60_000 },
    );
    await page.evaluate(
      () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
    );
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `qa/out/${prefix}${pose}.png` });
  });
}

test(`hero: ${world}/overview with UI`, async ({ page }) => {
  await page.goto(`/?world=${world}&pose=overview&freeze=1`);
  await page.waitForFunction(
    () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(
    () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
  );
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `qa/out/${prefix}hero.png` });
});

test(`story: ${world}/climb with data panel`, async ({ page }) => {
  await page.goto(`/?world=${world}&pose=climb&freeze=1&ui=1`);
  await page.waitForFunction(
    () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(
    () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
  );
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `qa/out/${prefix}story.png` });
});

test(`ghost: ${world}/climb`, async ({ page }) => {
  await page.goto(`/?world=${world}&pose=climb&freeze=1&ui=1&ghost=1`);
  await page.waitForFunction(
    () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(
    () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
  );
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `qa/out/${prefix}ghost.png` });
});

test('arthurs: real ghost at the summit', async ({ page }) => {
  await page.goto(
    '/?ride=arthurs&world=google3d&pose=summit&freeze=1&ui=1&ghost=1',
  );
  await page.waitForFunction(
    () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(
    () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
  );
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'qa/out/arthurs-ghost.png' });
});

test('arthurs: ghost picker', async ({ page }) => {
  await page.goto(
    '/?ride=arthurs&world=google3d&pose=summit&freeze=1&ui=1&ghost=1',
  );
  await page.waitForFunction(
    () => (window as unknown as { __relive?: { ready?: boolean } }).__relive?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(
    () => (window as unknown as { __relive: { whenIdle: () => Promise<void> } }).__relive.whenIdle(),
  );
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'qa/out/arthurs-ghost-picker.png' });
  await page.selectOption('.ghost-picker', 'arthurs-ghost-2025-01-27');
  await expect(page.locator('#ghost')).toContainText('27 Jan');
  await page.waitForTimeout(2500);
});
