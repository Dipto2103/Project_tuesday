import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Windows & Desktop Scroll Layout Verification', () => {
  it('AppShell conditionally applies overflow-hidden on /map and overflow-y-auto on content routes', () => {
    const appShellPath = path.resolve(__dirname, '../src/components/layout/AppShell.tsx');
    const content = fs.readFileSync(appShellPath, 'utf-8');

    // Verify main content container has dynamic overflow class
    expect(content).toContain("location.pathname === '/map' ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto'");

    // Verify auto-scroll reset on route change exists
    expect(content).toContain('mainRef.current.scrollTop = 0');
    expect(content).toContain('[location.pathname]');
  });

  it('Custom scrollbars in index.css are accessible for Windows desktop', () => {
    const cssPath = path.resolve(__dirname, '../src/styles/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    // Standard cross-browser scrollbar properties
    expect(content).toContain('scrollbar-color: #3A4454 #0B0D10');
    expect(content).toContain('scrollbar-width: thin');

    // Accessible scrollbar dimensions for mouse grabbing (10px)
    expect(content).toContain('width: 10px');
    expect(content).toContain('height: 10px');
    expect(content).toContain('border: 2px solid #0B0D10');
    expect(content).toContain('::-webkit-scrollbar-thumb:hover');
  });

  it('Scrollable asides and panels do not use justify-between with overflow-y-auto', () => {
    const filesToCheck = [
      '../src/pages/RoutePlannerPage.tsx',
      '../src/pages/CompareRoutesPage.tsx',
      '../src/pages/HazardPage.tsx',
      '../src/pages/PlannerPage.tsx',
      '../src/pages/RoverExplorerPage.tsx'
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(__dirname, relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Matching any <aside tag that contains both justify-between and overflow-y-auto
      const asideRegex = /<aside[^>]*class(?:Name)?=["'][^"']*["']/g;
      const matches = content.match(asideRegex) || [];

      for (const match of matches) {
        const hasJustifyBetween = match.includes('justify-between');
        const hasOverflowYAuto = match.includes('overflow-y-auto');

        expect(
          hasJustifyBetween && hasOverflowYAuto,
          `File ${relPath} should not have justify-between and overflow-y-auto on the same aside element: ${match}`
        ).toBe(false);
      }
    }
  });

  it('Scrollable flex child containers include min-h-0 to prevent flexbox overflow on Windows/Chromium', () => {
    const filesAndClassSnippets = [
      {
        path: '../src/pages/RoutePlannerPage.tsx',
        snippet: 'shrink-0 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/CompareRoutesPage.tsx',
        snippet: 'shrink-0 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/HazardPage.tsx',
        snippet: 'shrink-0 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/PlannerPage.tsx',
        snippet: 'shrink-0 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/RoverExplorerPage.tsx',
        snippet: 'shrink-0 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/MapPage.tsx',
        snippet: 'flex-1 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/SatellitePage.tsx',
        snippet: 'flex-1 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/pages/SkyPage.tsx',
        snippet: 'flex-1 min-h-0 overflow-y-auto'
      },
      {
        path: '../src/components/common/DocumentationModal.tsx',
        snippet: 'flex-1 min-h-0 overflow-y-auto'
      }
    ];

    for (const item of filesAndClassSnippets) {
      const fullPath = path.resolve(__dirname, item.path);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(
        content.includes(item.snippet),
        `${item.path} should contain snippet: "${item.snippet}"`
      ).toBe(true);
    }
  });
});
