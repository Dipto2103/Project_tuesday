# MARS LANTERN — Map Fix #2: Imagery Must Fill the Whole World (no blue/blank area)

**Supersedes** the following parts of earlier files wherever they conflict:
`MARS_LANTERN_MAP_FIX.md` §4.2, §4.4, §5.3, §6 (probe script), §10 check 6, §11 (zoom row) and `MARS_LANTERN_SPEC.md` §3.1 item 4 (`minZoom: 1`).
**Written:** 15 Nov 2026 · **Trigger:** screenshot of the running app showing Mars imagery in the top-left corner only, blue blank area everywhere else.

---

## 0. Correction of my earlier error (read first)

In `MARS_LANTERN_MAP_FIX.md` §4.2 I wrote that in Leaflet's `L.CRS.EPSG4326`, zoom 0 is **one** tile wide, so Trek matrix = Leaflet zoom − 1, and I told you to use `zoomOffset: -1`, `minZoom: 1`, `maxNativeZoom = maxMatrix + 1`. **That was wrong.**

Leaflet's `EPSG4326` uses the transformation `x' = scale·(lon/180 + 1)`, `y' = scale·(0.5 − lat/180)` with `scale = 256·2^z`. So the world at zoom *z* is:

```
width  = 512 · 2^z  px   (2^(z+1) tiles of 256 px)
height = 256 · 2^z  px   (2^z     tiles of 256 px)
```
At z = 0 that is **2 columns × 1 row**, exactly Trek's first WMTS matrix. Therefore:

| Setting | Wrong (my earlier text) | Correct |
|---|---|---|
| `zoomOffset` | `-1` | **`0`** (Leaflet zoom *z* ≡ Trek TileMatrix *z*) |
| `minNativeZoom` | `1` | **`0`** |
| `maxNativeZoom` | `maxMatrix + 1` | **`maxMatrix`** |
| `minZoom` | `1` | **fitted to the container (§3), never below 0** |

If Antigravity followed my earlier text, this is almost certainly the bug in your screenshot (next section). The calibration step I asked for would have caught it, which is why §5 makes it automatic.

---

## 1. What the screenshot proves

Measured from the screenshot (pixels, approximate):

| Region | x-range | y-range | size |
|---|---|---|---|
| Mars image | 403 → 951 | 118 → 391 | ≈ 548 × 273 |
| Blue area (the map's real world frame) | 403 → ≈1500 | 118 → ≈665 | ≈ 1097 × 547 |

1. The image is **exactly half the width and half the height** of the world frame, pinned to the top-left corner. It shows the **whole globe** (both polar caps visible at its top and bottom edges), not a zoomed-in piece.
2. The markers are spread over the **whole blue frame**, so marker positioning uses the correct world frame; only the imagery is wrong.
   - Check 1: the selected location is Jezero (18.44°N, 77.45°E). Expected position in the frame: x = 403 + (77.45+180)/360 · 1097 ≈ **1187**, y = 118 + (90−18.44)/180 · 547 ≈ **336**. The red marker with the halo sits at ≈ (1188, 335). ✔
   - Check 2: a marker sits at ≈ (1168, 521). Hellas Planitia centre (≈42.4°S, 70°E) would be at ≈ (1164, 520) in the frame. ✔ (The white Hellas basin in the squeezed image is at ≈ (785, 315), the same place scaled to a quarter of the area.)
3. Image orientation is correct (−180…180, east-positive); it is only too small.

**Best-fitting explanation (≈ matches every observation):** the app runs at about Leaflet zoom 1 (world 1024 × 512 = 4×2 tiles) while the tile layer, because of `zoomOffset: -1`, asks Trek for **matrix 0** tiles (2×1 grid) at tile coordinates `x 0..3, y 0..1`. Only `(col 0,row 0)` and `(col 1,row 0)` exist; they are drawn at the first two tile slots, covering the top-left quarter of the frame. The other six requests return nothing, so the container background shows through.

Other things that would produce the same picture (the check in §2 tells them apart):
- an `L.imageOverlay` of the global mosaic (e.g. `fallback-global.jpg` or an older local image) whose `bounds` are not `[[-90,-180],[90,180]]`;
- a layer whose `maxNativeZoom` / URL `{z}` handling applies the offset twice.

**Where the blue comes from is not known** (probably a `.leaflet-container` / Tailwind background class). Either way, it must change (§4.2): blank must never look like a deliberate colour.

---

## 2. Confirm the cause in 2 minutes (do before editing)

1. Open `#/map`, DevTools → **Network**, filter `trek.nasa.gov/tiles`, hard-reload.
2. Read the URLs: `…/default028mm/{matrix}/{row}/{col}.jpg`.

| What you see | Meaning |
|---|---|
| `/0/0/0.jpg`, `/0/0/1.jpg` return 200, and `/0/0/2.jpg`, `/0/0/3.jpg`, `/0/1/0.jpg` … 404 or never requested, while the map is at about zoom 1 | **Double offset** (expected cause). The matrix in the URL is one lower than the Leaflet zoom. |
| No Trek tile requests, but the DOM has `<img class="leaflet-image-layer">` | An **imageOverlay with wrong bounds** is the only imagery. |
| Requests at the right matrix, all 200, but still a quarter | Check `tileSize` (must equal `TileWidth` in `GetCapabilities`, normally 256) and any CSS scaling the tile pane. |

3. In the console: `map.getZoom()` and `map.getPixelBounds()` (expose the map as `window.__map` in dev only). World width in px at that zoom must equal `512·2^zoom`.
4. Write the result in `docs/MAP_LOOP_ROOT_CAUSE.md` under a new heading "Quarter-map bug".

---

## 3. Required behaviour: the imagery fills the world, the world fills the page

1. **World frame** is the constant `WORLD = [[-90,-180],[90,180]]` in one file. Tile layer `bounds`, `maxBounds`, any `imageOverlay`, graticule and the calibration corners all use it. No other bounds literal may exist in `src/map/`.
2. **Zoom mapping:** Leaflet zoom *z* ≡ Trek TileMatrix *z*. Row 0 = north. Do not set `tms`.
3. **Fit to the page ("cover")**: at the lowest zoom the world must fully cover the map container, with no empty margin. The map container itself must fill its page region (no fixed 2:1 box).
   - Exact minimum zoom: `minZoom = max(0, log2(max(W/512, H/256)))`, where W×H is the container size in CSS px.
   - A container that is wider than 2:1 will show the full width and crop some north/south (user can pan). Taller than 2:1 will crop east/west. That is intended; **never show blue/blank**.
4. **No blank, ever:** a permanent low-resolution global image sits **under** the NASA tiles. If a Trek tile is slow, missing or the network drops, the user sees the cached mosaic, not an empty colour. (Regional layers such as HiRISE are *overlays* with transparent gaps; they sit on top of a global base, so gaps are fine.)
5. **Neutral container colour:** `.leaflet-container { background:#0B0D10 }`. Remove any blue (`bg-blue-*`, `#00008b`-like) background from the map container, its parents inside the map area, and any "ocean" style. The only legitimate blank is a ≤ 1-frame flash while tiles load.

---

## 4. Code changes (replace the old versions)

### 4.1 `src/map/MarsMap.ts`

**Constants**
```ts
const WORLD = L.latLngBounds([-90, -180], [90, 180]);   // the ONLY bounds literal
const TILE = 256;                                        // must equal TileWidth in GetCapabilities
const worldPxW = (z: number) => 2 * TILE * 2 ** z;       // EPSG:4326: 2^(z+1) tiles wide
const worldPxH = (z: number) => TILE * 2 ** z;           // 2^z tiles tall
```

**Map options**
```ts
this.map = L.map(o.container, {
  crs: L.CRS.EPSG4326,
  minZoom: 0,                      // refined by fitMinZoomToContainer()
  maxZoom: 11,
  zoomSnap: 0.5, zoomDelta: 0.5,
  maxBounds: WORLD, maxBoundsViscosity: 1.0,
  worldCopyJump: false,
  zoomControl: false, attributionControl: true, preferCanvas: true,
});
this.map.createPane('basefallback'); this.map.getPane('basefallback')!.style.zIndex = '150';  // below tilePane (200)
this.fitMinZoomToContainer();                                   // BEFORE the first setView
const startZ = Math.max(o.initial?.zoom ?? 0, this.map.getMinZoom());
this.map.setView(o.initial ? [o.initial.lat, lon360ToDisplay(o.initial.lonE)] : [0, 0], startZ, { animate: false });
```

**Fit-to-container (replaces the old method)**
```ts
private fitMinZoomToContainer() {
  const { x: w, y: h } = this.map.getSize();
  if (!w || !h) return;                                         // container not laid out yet; ResizeObserver will call again
  const z = Math.max(0, Math.log2(Math.max(w / (2 * TILE), h / TILE)));   // world covers container
  this.map.setMinZoom(z);
  if (this.map.getZoom() < z) this.map.setZoom(z, { animate: false });
  this.map.setMaxBounds(WORLD);                                 // re-apply so the pan limits follow the new size
}
resetView() { this.map.setView([0, 0], this.map.getMinZoom(), { animate: false }); }
```

**Permanent fallback underlay + base layer**
```ts
private installFallbackUnderlay() {
  if (!this.o.fallbackImageUrl) return;
  this.fallback = L.imageOverlay(this.o.fallbackImageUrl, WORLD, { pane: 'basefallback', interactive: false, opacity: 1 }).addTo(this.map);
}

setBaseLayer(id: string) {
  const def = this.layers.get(id); if (!def) return;
  if (this.base) this.map.removeLayer(this.base);
  this.base = L.tileLayer(def.urlTemplate, {
    tileSize: TILE,
    noWrap: true, bounds: WORLD,
    zoomOffset: 0,                  // Leaflet z == Trek TileMatrix. (Earlier "-1" was wrong.)
    minNativeZoom: 0,
    maxNativeZoom: def.maxMatrix,   // NOT maxMatrix + 1
    maxZoom: 11,
    attribution: def.attribution,
    errorTileUrl: TRANSPARENT_PNG,  // transparent, so the fallback underlay shows through
    updateWhenIdle: true, keepBuffer: 2,
  }).addTo(this.map);
  this.base.on('tileerror', this.handleTileError);
  this.base.on('tileload', () => { this.tileErrors.length = 0; });
  if (import.meta.env.DEV) this.base.on('tileloadstart', this.assertTileInGrid);
}

// dev-only contract: a requested tile must exist in the matrix grid
private assertTileInGrid = (e: any) => {
  const { x, y, z } = e.coords as { x: number; y: number; z: number };
  const cols = 2 ** (z + 1), rows = 2 ** z;
  ((window as any).__tileLog ??= []).push({ z, x, y });
  if (x < 0 || x >= cols || y < 0 || y >= rows) console.error('TILE OUT OF GRID', { z, x, y, cols, rows });
};
```
`handleTileError` now only flips the UI banner ("Cached basemap — detailed tiles unavailable"); it no longer *adds* the overlay (the underlay is always there).

Call `installFallbackUnderlay()` in the constructor before `setBaseLayer`. Create `public/tiles/fallback-global.jpg` (4096 × 2048, equirectangular, −180…180, north up) from the USGS Viking colorized mosaic or from stitched Trek matrix-4 tiles; log its origin in `docs/DATA_PROVENANCE.md`. It must be 2:1; the code stretches it to `WORLD`, so a non-2:1 file will distort.

### 4.2 CSS (`src/styles/index.css`)
```css
.leaflet-container { background: #0B0D10; }            /* neutral; never blue */
/* Leaflet owns marker positioning via transform. NEVER animate/transform .leaflet-marker-icon or .ml-marker. */
.ml-marker > span { display:block; width:100%; height:100%; border-radius:50%; }
.ml-marker.is-selected > span { animation: ml-pulse 2s ease-out infinite; }   /* animate the INNER element only */
@keyframes ml-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,176,112,.6) } 100% { box-shadow: 0 0 0 14px rgba(255,176,112,0) } }
```
Remove any rule that sets `transform`, `translate`, `top/left`, `margin` or `animation` on `.leaflet-marker-icon` / `.ml-marker`; that makes markers drift.

### 4.3 Probe script change (`scripts/probe-trek.ts`)
- Output `maxMatrix` as found; the app now uses it directly as `maxNativeZoom`. Remove any `+ 1`.
- Read `TileWidth`/`TileHeight` from the layer's `WMTSCapabilities.xml` (`<TileWidth>256</TileWidth>`) and write `tileSize` into `layers.json`. If it is not 256, `TILE` must follow it and the zoom maths in §4.1 must be rechecked.
- Re-run the probe after the change and commit the new `layers.json`.

### 4.4 Layout (the map must fill its region)
- Page chain from the app shell down to the map: `display:flex; flex-direction:column; min-height:0` with the map wrapper `flex:1 1 0; min-height:0; position:relative`. The map `div` is `absolute inset-0` inside that wrapper. No fixed pixel height, no `aspect-ratio` on the container.
- Call `invalidateSize()` after the sidebar collapses/expands and after route transitions (ResizeObserver already covers it if the container really changes size).
- **UI overlays are not data:** the right-hand control stack, the bottom cursor bar and the "Rover Tracks" toast currently cover map area (in the screenshot a marker at the right edge is partly hidden). Either keep overlays inside a 64 px inset the user can't pan markers under (use `paddingTopLeft/paddingBottomRight` in `flyTo`/`fitBounds`), or make the toast dismissible. Markers inside the covered strip must remain reachable by keyboard and by panning.

---

## 5. Automatic proof that nothing is blank and markers are accurate

### 5.1 Calibration mode `?calibrate=1` (dev + preview builds)
Renders on top of the map, all through `lon360ToDisplay`:
- 4 corner crosshairs at (±90, ±180) labelled with coordinates; they must sit exactly on the corners of the imagery.
- Landmark crosshairs (coordinates are from the earlier specs/public mission knowledge; confirm each against its NASA page and record in `docs/DATA_PROVENANCE.md`): Olympus Mons summit (18.65°N, 226.2°E), Jezero (18.44°N, 77.45°E), Bradbury Landing (4.59°S, 137.44°E), Hellas Planitia centre (≈42.4°S, 70°E), Gale-view centre from your Trek link (−6.5435°, 137.1817°E).
- A live readout of `world px width` vs `512·2^zoom` and `minZoom`.

### 5.2 Playwright coverage test (`tests/map-coverage.spec.ts`, needs `pngjs`)
```ts
import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const BG = [0x0B, 0x0D, 0x10];
const near = (r:number,g:number,b:number, c:number[]) => Math.abs(r-c[0])+Math.abs(g-c[1])+Math.abs(b-c[2]) < 24;

for (const vp of [{ width: 1440, height: 800 }, { width: 1100, height: 900 }, { width: 390, height: 780 }]) {
  test(`world fully covered at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/map');
    await page.addStyleTag({ content: '.leaflet-marker-pane,.leaflet-control-container,.ml-overlay{visibility:hidden!important}' });
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loading').length === 0, null, { timeout: 30000 });
    const png = PNG.sync.read(await page.locator('.leaflet-container').screenshot());
    // split into 4 quadrants; each must be < 3% background-coloured
    const { width: W, height: H, data } = png;
    for (const [qx, qy] of [[0,0],[1,0],[0,1],[1,1]]) {
      let bg = 0, n = 0;
      for (let y = Math.floor(qy*H/2); y < Math.floor((qy+1)*H/2); y += 4)
        for (let x = Math.floor(qx*W/2); x < Math.floor((qx+1)*W/2); x += 4) {
          const i = (y*W + x) * 4; n++; if (near(data[i], data[i+1], data[i+2], BG)) bg++;
        }
      expect(bg / n, `quadrant ${qx},${qy} is blank`).toBeLessThan(0.03);
    }
  });
}

test('no out-of-grid tile requests and no loop', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (/TILE OUT OF GRID|MAP LOOP/.test(m.text())) errors.push(m.text()); });
  await page.goto('/#/map?calibrate=1');
  await page.waitForTimeout(5000);
  expect(errors).toEqual([]);
});
```
Notes: the 3% threshold tolerates Mars's genuinely dark terrain only if the container background is not a dark Mars-like colour; because the background is `#0B0D10` (near-black) and Viking imagery is brownish, if the test shows false positives on dark regions, change `BG` to a unique debug colour (`#FF00FF`) set by the test via `addStyleTag` (`.leaflet-container{background:#ff00ff!important}`) and leave the underlay in place. That is the more robust form and is the one to ship.

### 5.3 Marker accuracy
- `scripts/validate-checkpoints.ts` (runs in CI): every record has `-90 ≤ lat ≤ 90`, `0 ≤ lonE < 360`, unique `id`, `coordSource` present; warn on two records closer than 0.05° (stacked icons, like the overlapping rings visible in the screenshot) and on records with `coordSource: 'memory-verify'` still unverified.
- Position check in the browser: for each marker, `map.latLngToContainerPoint([lat, lon360ToDisplay(lonE)])` must equal the marker element's centre within 1 px (`getBoundingClientRect`). Catches CSS transforms overriding Leaflet's positioning.
- Visual check using the imagery: Jezero marker on Jezero crater, Gale marker in Gale, Olympus Mons marker on the volcano, Hellas on the basin, polar sites near the caps. If markers are off by a constant longitude (e.g. 180° or 360°), the longitude convention is wrong.
- Stacked/near-identical points: cluster with `leaflet.markercluster` after the basic map passes, or spiderfy at high zoom.

---

## 6. Acceptance criteria (all must pass; paste real outputs)

| # | Check | Expected |
|---|---|---|
| 1 | Network tab at first load | Tile URLs have matrix = `Math.round(map.getZoom())` (not one lower); responses 200 across the whole visible grid |
| 2 | Visual, desktop 1440×800 and a 390 px phone | Imagery covers the whole map area; no blue/blank anywhere |
| 3 | Resize the window and collapse/expand the sidebar | Imagery re-covers the area; no gap appears |
| 4 | Pan to all four edges | Hard stop at ±180 / ±90; no repeat; no blank beyond imagery |
| 5 | Zoom min → max | Detail increases smoothly; no jump of 2× at any step; "Beyond data resolution" past `maxMatrix` |
| 6 | `?calibrate=1` | Corner crosshairs on the image corners; landmark crosshairs on their features; `world px width == 512·2^zoom` |
| 7 | Block `trek.nasa.gov` in DevTools, reload | Cached global mosaic fills the whole map, banner shows; still no blue |
| 8 | Playwright coverage + marker-position tests | Pass |
| 9 | Scale bar across 10° of equator | ≈ 593 km |
| 10 | Idle 10 s in Performance | No repeating scripting tasks (the loop fix from the earlier file still applies) |

---

## 7. Prompt for Antigravity (paste this)

```
PROJECT: MARS LANTERN — MAP FIX #2 (imagery fills the world)
Read docs/MAP_FIX_2.md (this file) first. It overrides the zoom/offset parts of docs/MAP_FIX_SPEC.md.

SYMPTOM: Mars imagery appears only in the top-left quarter of the map; the rest is blue/blank. Markers are positioned over the whole frame correctly (Jezero and Hellas checked by pixel maths in §1).
LIKELY CAUSE: tile layer zoomOffset -1 (wrong). In L.CRS.EPSG4326, Leaflet zoom z has a 2^(z+1) × 2^z tile grid, identical to Trek TileMatrix z. Offset must be 0.

STEPS (commit after each; run build + tests between):
F0  Run the Network-tab check in §2. Record result in docs/MAP_LOOP_ROOT_CAUSE.md ("Quarter-map bug"). If the cause differs, report it before changing code.
F1  Apply §4.1: zoomOffset 0, minNativeZoom 0, maxNativeZoom = maxMatrix, minZoom from fitMinZoomToContainer (exact formula), WORLD as the only bounds literal. Remove any "+ 1" from probe/registry code and re-run scripts/probe-trek.ts; read TileWidth from GetCapabilities.
F2  Add the permanent fallback underlay pane (§4.1) using public/tiles/fallback-global.jpg (2:1, -180..180). Create the file if missing and document its source.
F3  CSS (§4.2): neutral container background; remove any blue background; animate only inner marker elements; remove transforms on .leaflet-marker-icon.
F4  Layout (§4.4): the map wrapper fills its region (flex, min-h-0, absolute inset-0). Overlays must not hide markers permanently.
F5  Add ?calibrate=1 (§5.1), scripts/validate-checkpoints.ts and the Playwright tests (§5.2–5.3).
F6  Walk the acceptance table in §6 and paste real results.

HARD RULES
- Do not guess Trek layer ids, zoom limits or tile sizes; read them from the probe / GetCapabilities.
- Never leave blank map area: the global fallback image is always underneath.
- Never use Leaflet's Earth-radius distance helpers; use haversineKm with 3389.5 km.
- Do not claim a fix works until you have run it and shown the output. Say plainly what you could not verify.
FINISH: list changed files, paste test output, state which acceptance rows passed or are still open.
```

---

## 8. Things still unverified (state them in the final report)
- Which of the §1 causes is actually in your code: the evidence points at the double offset, but only the Network-tab check confirms it.
- Whether Trek's tile size is 256 for every layer you add (must be read, not assumed).
- Exact `maxMatrix` per layer (probe output decides).
- Landmark coordinates in §5.1 other than your own Trek link (`memory-verify` until checked against NASA pages).
