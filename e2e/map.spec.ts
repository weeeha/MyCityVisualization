import { test, expect } from '@playwright/test';

test('the map actually draws, not just mounts', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(5000);   // tiles + first render

  // A prior agent found that WebGL pixel reads return all-black in an
  // unfocused page even when the map is painted correctly — force focus
  // before sampling so a failure here means the map, not the test runner.
  await page.bringToFront();

  // WebGL failures do not throw — they yield a uniform black canvas that
  // passes every DOM assertion. Sample pixels and require variation.
  const sample = async () => page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    off.getContext('2d')!.drawImage(c, 0, 0);
    const { data } = off.getContext('2d')!.getImageData(0, 0, off.width, off.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4 * 997) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });

  let distinct = await sample();
  if (distinct <= 5) {
    // Safari's WebGL init can be slower — give it more time, once, before
    // concluding the map is actually broken.
    await page.waitForTimeout(3000);
    distinct = await sample();
  }
  expect(distinct).toBeGreaterThan(5);
});

test('the air layer toggles and shows its legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('legend-air')).toBeVisible();
  await expect(page.getByTestId('legend-air')).toContainText(/station/i);

  await page.getByTestId('toggle-air').click();
  await expect(page.getByTestId('legend-air')).toHaveCount(0);
  await expect(page).toHaveURL(/layers=(&|$)/);
});

test('a shared URL restores the exact view', async ({ page }) => {
  await page.goto('/?layers=air&at=45.5088,-73.5678,15,60,-20');
  await page.waitForTimeout(3000);

  // The shell canonicalises the query string via URLSearchParams on the
  // first camera event (see writeUrlState in src/shell/Shell.tsx), which
  // percent-encodes the comma separators (','  -> '%2C') — identically on
  // Chromium and WebKit. Assert on the decoded param so this checks the
  // restored values, not one particular string encoding.
  const at = new URL(page.url()).searchParams.get('at');
  expect(at).toMatch(/^45\.5088,-73\.5678,/);
  await expect(page.getByTestId('legend-air')).toBeVisible();
});

test('an upstream failure degrades to an error, not a blank app', async ({ page }) => {
  await page.route('**/api/layers/air', (r) =>
    r.fulfill({ status: 503, body: '{"error":"down"}' }));
  await page.goto('/');
  await expect(page.getByTestId('legend-air')).toContainText(/unavailable/i);
  await expect(page.locator('canvas').first()).toBeVisible();   // map still there
});
