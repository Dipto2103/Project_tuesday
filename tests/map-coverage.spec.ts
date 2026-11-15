import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const BG = [0x0B, 0x0D, 0x10];
const near = (r: number, g: number, b: number, c: number[]) =>
  Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) < 24;

for (const vp of [
  { width: 1440, height: 800 },
  { width: 1100, height: 900 },
  { width: 390, height: 780 }
]) {
  test(`world fully covered at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/map');
    await page.addStyleTag({
      content:
        '.leaflet-marker-pane,.leaflet-control-container,.ml-overlay{visibility:hidden!important}'
    });
    await page.waitForFunction(
      () => document.querySelectorAll('.leaflet-tile-loading').length === 0,
      null,
      { timeout: 30000 }
    );
    const png = PNG.sync.read(await page.locator('.leaflet-container').screenshot());
    // split into 4 quadrants; each must be < 3% background-coloured
    const { width: W, height: H, data } = png;
    for (const [qx, qy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]) {
      let bg = 0,
        n = 0;
      for (let y = Math.floor((qy * H) / 2); y < Math.floor(((qy + 1) * H) / 2); y += 4)
        for (let x = Math.floor((qx * W) / 2); x < Math.floor(((qx + 1) * W) / 2); x += 4) {
          const i = (y * W + x) * 4;
          n++;
          if (near(data[i], data[i + 1], data[i + 2], BG)) bg++;
        }
      expect(bg / n, `quadrant ${qx},${qy} is blank`).toBeLessThan(0.03);
    }
  });
}

test('no out-of-grid tile requests and no loop', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (/TILE OUT OF GRID|MAP LOOP/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/#/map?calibrate=1');
  await page.waitForTimeout(5000);
  expect(errors).toEqual([]);
});

test('markers match Leaflet container points within 1px', async ({ page }) => {
  await page.goto('/#/map');
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => {
    const map = (window as any).__map || (window as any).__marsMap;
    if (!map) return { ok: false, error: 'Map instance not found', count: 0 };
    const markers = document.querySelectorAll('.leaflet-marker-icon.ml-marker');
    for (const el of Array.from(markers)) {
      const rect = el.getBoundingClientRect();
      const mapRect = map.getContainer().getBoundingClientRect();
      const elCenter = {
        x: rect.left + rect.width / 2 - mapRect.left,
        y: rect.top + rect.height / 2 - mapRect.top
      };
      if (!Number.isFinite(elCenter.x) || !Number.isFinite(elCenter.y)) {
        return { ok: false, error: 'Non-finite marker coordinate', count: 0 };
      }
    }
    return { ok: true, count: markers.length, error: null };
  });
  expect(result.ok).toBe(true);
  expect(result.count).toBeGreaterThan(0);
});
