import { test, expect } from '@playwright/test';

test.describe('Desktop & Windows Scroll Functionality', () => {
  test('content pages have scrollable main content and scroll properly', async ({ page }) => {
    // Test on a standard desktop viewport (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });

    const contentRoutes = [
      '/',
      '/terrain',
      '/survival',
      '/field-manual',
      '/science',
      '/weather',
      '/planner/briefing'
    ];

    for (const route of contentRoutes) {
      await page.goto(`/#${route}`);
      await page.waitForTimeout(500);

      const scrollInfo = await page.evaluate(() => {
        const main = document.getElementById('main-content');
        if (!main) return { found: false, scrollHeight: 0, clientHeight: 0, canScroll: false };
        const style = window.getComputedStyle(main);
        return {
          found: true,
          scrollHeight: main.scrollHeight,
          clientHeight: main.clientHeight,
          canScroll: main.scrollHeight > main.clientHeight,
          overflowY: style.overflowY
        };
      });

      expect(scrollInfo.found, `main-content element exists on ${route}`).toBe(true);
      expect(scrollInfo.overflowY, `overflow-y on ${route} should be auto`).toBe('auto');
      expect(scrollInfo.canScroll, `page ${route} has scrollable content`).toBe(true);

      // Verify scrolling down works and changes scrollTop
      await page.evaluate(() => {
        const main = document.getElementById('main-content');
        if (main) main.scrollTop = 300;
      });
      await page.waitForTimeout(100);

      const scrolledTop = await page.evaluate(() => {
        const main = document.getElementById('main-content');
        return main ? main.scrollTop : 0;
      });
      expect(scrolledTop, `main-content scrolled down on ${route}`).toBeGreaterThan(0);
    }
  });

  test('route navigation resets main scroll offset to 0', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/survival');
    await page.waitForTimeout(500);

    // Scroll down on survival page
    await page.evaluate(() => {
      const main = document.getElementById('main-content');
      if (main) main.scrollTop = 400;
    });
    await page.waitForTimeout(100);

    // Navigate to terrain page
    await page.goto('/#/terrain');
    await page.waitForTimeout(500);

    const scrollTopAfterNav = await page.evaluate(() => {
      const main = document.getElementById('main-content');
      return main ? main.scrollTop : -1;
    });

    expect(scrollTopAfterNav, 'scroll offset resets to 0 upon route navigation').toBe(0);
  });

  test('map page maintains overflow-hidden to prevent body/page scrollbars', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/map');
    await page.waitForTimeout(500);

    const mapScroll = await page.evaluate(() => {
      const main = document.getElementById('main-content');
      if (!main) return { overflowY: '', scrollHeight: 0, clientHeight: 0 };
      const style = window.getComputedStyle(main);
      return {
        overflowY: style.overflowY,
        scrollHeight: main.scrollHeight,
        clientHeight: main.clientHeight
      };
    });

    expect(mapScroll.overflowY).toBe('hidden');
    expect(mapScroll.scrollHeight).toBe(mapScroll.clientHeight);
  });

  test('split-screen side panels on specialized planner and hazard pages have min-h-0 and scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const pagesWithAsides = [
      '/planner/route',
      '/planner/compare',
      '/hazards',
      '/rovers',
      '/planner'
    ];

    for (const route of pagesWithAsides) {
      await page.goto(`/#${route}`);
      await page.waitForTimeout(500);

      const asideInfo = await page.evaluate(() => {
        const aside = document.querySelector('aside');
        if (!aside) return { found: false, minHeight: '', overflowY: '' };
        const style = window.getComputedStyle(aside);
        return {
          found: true,
          minHeight: style.minHeight,
          overflowY: style.overflowY
        };
      });

      expect(asideInfo.found, `aside element exists on ${route}`).toBe(true);
      expect(asideInfo.overflowY, `aside overflow-y on ${route} is auto`).toBe('auto');
      expect(asideInfo.minHeight, `aside min-height on ${route} is 0px (min-h-0)`).toBe('0px');
    }
  });
});
