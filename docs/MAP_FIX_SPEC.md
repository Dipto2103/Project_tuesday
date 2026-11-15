# MARS LANTERN — Map Fix Specification (for Antigravity IDE)

**Scope:** fix and rebuild the Mars map only (`/map` route and everything the map feeds: checkpoints, location report, routes, satellite deep-links).
**Companion file:** `MARS_LANTERN_SPEC.md` (full product spec). This file is the detailed, map-only, implementation-level document. Where the two disagree on map behaviour, **this file wins**.
**Written:** 15 Nov 2026

> Put this file in `docs/MAP_FIX_SPEC.md`. Paste the **Antigravity prompt (Section 12)** into the agent.

---

## 0. Honest status: what was and was not verified

| Item | Status |
|---|---|
| `main.tsx`, `App.tsx`, `vite-env.d.ts` | **Read.** `main.tsx` already uses `HashRouter` and imports `leaflet/dist/leaflet.css`. `App.tsx` already lazy-loads `MapPage`, `SatellitePage`, `SkyPage`, etc. Nothing in these three files causes a map loop. |
| `MapPage.tsx` and any map component | **Not uploaded.** The root cause of the "infinite loop" is therefore *unconfirmed*. Section 3 gives a diagnosis procedure; the agent must run it first and write the finding down before editing. |
| Trek WMTS URL template (`{WMTS endpoint}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{ext}`), "2 columns × 1 row at the first zoom level", "missing tile = no coverage" | **Confirmed** from NASA's Trek API page (`trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars`). |
| Viking color mosaic layer id | **Two spellings found in public sources:** `Mars_Viking_MDIM21_ClrMosaic_global_232m` (NASA API catalog, `api.nasa.gov/mars-wmts/catalog/...`; capabilities list style `default`, matrix set `default028mm`, format `image/jpg`, bbox −180 −90 180 90) and `Viking_MDIM21_ClrMosaic_global_232m` (a third-party Trek viewer's URL example). **Do not guess; run the probe script in §6.** |
| Max native zoom of each layer | **Unknown.** Read it from `GetCapabilities` / probe. The ≈ 8 estimate in §5 is arithmetic from 232 m/px, not a NASA statement. |
| Leaflet `zoomOffset` reasoning (§4.2) | **Derived from Leaflet's EPSG:4326 maths, not run.** The calibration test in §10 is what proves it. |
| Trek's in-app terrain/route tools | Interactive features of the Trek website. **No public API for them was found.** Do not build on them (see §7). |

---

## 1. What the Trek link in your brief tells us

```
https://trek.nasa.gov/mars/#v=0.1&x=137.18169410377863&y=-6.543469565266718&z=9
 &p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=&locale=&b=mars
 &e=136.30278787017335%2C-6.9808627455843375%2C138.0606003373839%2C-6.106076384949098&sfz=&w=
```

| Param | Value | Meaning |
|---|---|---|
| `x` | 137.1817 | Centre **longitude, east-positive** (0–360 convention; here also valid in −180..180) |
| `y` | −6.5435 | Centre **latitude** (planetocentric) |
| `z` | 9 | **Trek's own viewer zoom.** Do **not** assume it equals a WMTS TileMatrix number or a Leaflet zoom. |
| `p` | `EPSG::104905` | Mars geographic (lon/lat) CRS used by Trek's viewer. Our app uses plain lat/lon degrees with an equirectangular layout, which is compatible for display. |
| `b` | `mars` | Body |
| `e` | 136.30, −6.98, 138.06, −6.11 | Viewport extent as **west, south, east, north** (≈ 1.76° × 0.87°, roughly 104 km × 52 km) |
| `sfz`, `w`, `d`, `locale` | empty | Unused in this link |

The view is in the **Gale Crater region** (Curiosity's area). Use it as **calibration view #1**: our map opened at `lat −6.5435, lonE 137.1817` with the extent above must show the same features as Trek's page.

**Deep-link builder** (pattern copied from your link; not every parameter has been confirmed required):

```ts
// src/core/trekLink.ts
export function trekDeepLink(lat: number, lonE: number, z = 9, halfWidthDeg = 0.88, halfHeightDeg = 0.44) {
  const w = lonE - halfWidthDeg, e = lonE + halfWidthDeg, s = lat - halfHeightDeg, n = lat + halfHeightDeg;
  const ext = [w, s, e, n].map(v => v.toFixed(5)).join('%2C');
  return `https://trek.nasa.gov/mars/#v=0.1&x=${lonE.toFixed(5)}&y=${lat.toFixed(5)}&z=${z}` +
         `&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=&locale=&b=mars&e=${ext}&sfz=&w=`;
}
```
Use it for the **"Open this view in Mars Trek"** button on the map toolbar and in every Location Report.

---

## 2. Required end state

1. The map shows Mars as **one bounded world** (−180…180 lon, −90…90 lat). Panning to any edge **stops**. No repeating landmass, no duplicate markers.
2. No render loop: idle CPU ≈ 0, `moveend` fires only after user input or an explicit app action.
3. Tiles come from **NASA Mars Trek WMTS**, with URLs produced by the probe/registry script, not hand-typed.
4. If Trek is unreachable, a bundled low-res global image takes over with a visible banner.
5. Calibration markers (§10) sit on the right features.
6. Every map coordinate goes through **one module** (`src/core/geo.ts`).
7. Distance and scale are computed with the **Mars radius (3389.5 km)**, never Leaflet's Earth defaults (§4.5).

---

## 3. Root-cause procedure (do this BEFORE changing code)

Write the result in `docs/MAP_LOOP_ROOT_CAUSE.md` using the template at the end of this section. Two independent causes are common; both may be present.

### 3.1 Cause A: visual wrap (map repeats sideways)
Symptoms: pan left/right and the same landmass reappears; markers appear twice; tiles load for longitudes beyond ±180.
Typical code smell: `L.tileLayer(url)` without `noWrap: true`; default CRS (`EPSG3857`); `worldCopyJump: true`; no `maxBounds`.

### 3.2 Cause B: logic loop (the app keeps re-moving the map)
Symptoms: CPU spike, map keeps re-centring or flickering, "Maximum update depth exceeded", tiles reload constantly.
Typical code smell, search for each:
- `<MapContainer center={[...]} bounds={[...]}>` with arrays/objects recreated each render and passed to children that run effects.
- `useEffect(() => { map.setView/flyTo/fitBounds(...) }, [center, viewport, ...])` where the map's `moveend` handler sets state that is also in that dependency list.
- Route calculation inside render or in an effect that depends on state the route itself updates.
- `key={...}` on `MapContainer` that changes (remounts the map each time).
- React 18 `StrictMode` double-mounting an imperatively created map without cleanup → "Map container is already initialized" or two maps.

### 3.3 Commands
```bash
grep -rnE "worldCopyJump|noWrap|fitBounds|setView|flyTo|useMap|MapContainer|moveend|zoomend|CRS\." src | tee /tmp/map-grep.txt
```
Then DevTools → Performance → record 5 s on `#/map` and note repeating `setView`/`fitBounds`/React commits. Pan hard left to test Cause A.

### 3.4 Template: `docs/MAP_LOOP_ROOT_CAUSE.md`
```md
# Map loop root cause
Date: ... · Commit: ...
## Symptoms observed
## Evidence (grep lines, performance screenshot description, console output)
## Cause A (wrap): present / absent — why
## Cause B (logic loop): present / absent — which file:line, which dependency
## Fix applied (commit hash)
## How it was verified (commands + output)
```

---

## 4. Target map engine

### 4.1 Files to create / replace
```
src/core/geo.ts                  pure math, no DOM  (§4.3)
src/core/trekLink.ts             deep-link builder  (§1)
src/map/MarsMap.ts               imperative Leaflet wrapper (class, no React)   (§4.4)
src/map/MarsMapView.tsx          thin React shell around MarsMap               (§4.6)
src/map/layers.ts                loads public/data/layers.json + fallback      (§5)
src/map/markers.ts               checkpoint icons, clustering
src/map/MarsScale.ts             Mars-radius scale control                      (§4.5)
src/state/mapStore.ts            viewport + selection (Zustand or existing store)
scripts/probe-trek.ts            builds public/data/layers.json                 (§6)
public/tiles/fallback-global.jpg 4096×2048 global mosaic (build/download once)
```
Do **not** add MapLibre or another map framework. If `react-leaflet` is currently used, the map page stops using `MapContainer`; the library may remain for other components or be removed.

### 4.2 Why the CRS and `zoomOffset` matter
- Leaflet's default CRS is Web-Mercator for Earth. A Mars equirectangular mosaic must use `L.CRS.EPSG4326` (plain lon/lat degrees to pixels, 2:1 world).
- In Leaflet's EPSG:4326, **zoom 0 is one tile wide** (one 256 px tile spans 360°). Trek's first TileMatrix (0) is **two columns × one row** (each tile spans 180°). So **Trek matrix = Leaflet zoom − 1**.
- Therefore set `zoomOffset: -1` and `minZoom: 1` on every Trek layer. Leaflet zoom 1 → Trek matrix 0.
- Tile order in the URL is **`{TileMatrix}/{TileRow}/{TileCol}`** = `{z}/{y}/{x}`. Row 0 is the **north** edge, which matches Leaflet's y-down tile scheme. Do **not** set `tms: true`.
- Because `maxNativeZoom` is measured in Leaflet zoom (before the offset), `maxNativeZoom = maxMatrix + 1`.

> If the calibration test (§10) shows tiles shifted by exactly one zoom level or doubled/halved in size, this offset is the first thing to check.

### 4.3 `src/core/geo.ts`
```ts
export const MARS_RADIUS_KM = 3389.5;

export const normalizeLon360 = (lon: number) => ((lon % 360) + 360) % 360;
/** east-positive 0..360 → Leaflet display −180..180 */
export const lon360ToDisplay = (lon: number) => { const l = normalizeLon360(lon); return l > 180 ? l - 360 : l; };
/** display −180..180 → east-positive 0..360 */
export const displayToLon360 = (lon: number) => normalizeLon360(lon);
export const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number, R = MARS_RADIUS_KM) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
```
Rules: store `lat` + `lonE` (0–360) in all data; convert with `lon360ToDisplay` **only** at the Leaflet boundary. Tests required: 0/360 wrap, ±180 antimeridian, poles, haversine on a known pair.

### 4.4 `src/map/MarsMap.ts` (imperative wrapper)
```ts
import L from 'leaflet';
import { lon360ToDisplay, displayToLon360, clampLat } from '../core/geo';

const WORLD = L.latLngBounds([-90, -180], [90, 180]);
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface TrekLayerDef {
  id: string; title: string;
  urlTemplate: string;      // e.g. https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{y}/{x}.jpg
  maxMatrix: number;        // highest TileMatrix that exists (from probe / GetCapabilities)
  attribution: string;
}
export interface Viewport { lat: number; lonE: number; zoom: number; source: 'ui' | 'app' }
export interface MarkerDef { id: string; lat: number; lonE: number; label: string; html?: string; onClick?: () => void }

export interface MarsMapOptions {
  container: HTMLElement;
  layers: TrekLayerDef[];
  baseLayerId: string;
  initial?: { lat: number; lonE: number; zoom: number };
  fallbackImageUrl?: string;
  onViewport?: (v: Viewport) => void;      // debounced
  onMapClick?: (p: { lat: number; lonE: number }) => void;
  onBackendDegraded?: (degraded: boolean) => void;
}

export class MarsMap {
  private map: L.Map;
  private layers: Map<string, TrekLayerDef>;
  private base?: L.TileLayer;
  private markerGroup = L.layerGroup();
  private markers = new Map<string, L.Marker>();
  private routeLayer = L.layerGroup();
  private fallback?: L.ImageOverlay;
  private programmatic = 0;              // >0 while the app itself is moving the map
  private tileErrors: number[] = [];
  private moveTimes: number[] = [];      // loop guard
  private vpTimer?: number;
  private ro?: ResizeObserver;

  constructor(private o: MarsMapOptions) {
    this.layers = new Map(o.layers.map(l => [l.id, l]));
    const init = o.initial ?? { lat: 0, lonE: 0, zoom: 2 };

    this.map = L.map(o.container, {
      crs: L.CRS.EPSG4326,             // equirectangular; NOT Web-Mercator
      minZoom: 1,                      // Leaflet z1 == Trek matrix 0
      maxZoom: 11,
      zoomSnap: 0.5, zoomDelta: 0.5,
      maxBounds: WORLD, maxBoundsViscosity: 1.0,
      worldCopyJump: false,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    this.map.setView([init.lat, lon360ToDisplay(init.lonE)], init.zoom, { animate: false });

    this.markerGroup.addTo(this.map);
    this.routeLayer.addTo(this.map);
    this.setBaseLayer(o.baseLayerId);
    this.fitMinZoomToContainer();

    this.map.on('click', (e: L.LeafletMouseEvent) =>
      o.onMapClick?.({ lat: clampLat(e.latlng.lat), lonE: displayToLon360(e.latlng.lng) }));
    this.map.on('moveend', this.handleMoveEnd);

    this.ro = new ResizeObserver(() => { this.map.invalidateSize({ animate: false }); this.fitMinZoomToContainer(); });
    this.ro.observe(o.container);
  }

  /** The world must always fill the container: no grey margins, no empty wrap area. */
  private fitMinZoomToContainer() {
    const z = Math.max(1, this.map.getBoundsZoom(WORLD, true));
    this.map.setMinZoom(z);
    if (this.map.getZoom() < z) this.map.setZoom(z, { animate: false });
  }

  setBaseLayer(id: string) {
    const def = this.layers.get(id); if (!def) return;
    if (this.base) this.map.removeLayer(this.base);
    this.base = L.tileLayer(def.urlTemplate, {
      tileSize: 256,
      noWrap: true,                    // never repeat horizontally
      bounds: WORLD,
      zoomOffset: -1,                  // Leaflet zoom → Trek TileMatrix
      minNativeZoom: 1,
      maxNativeZoom: def.maxMatrix + 1,
      maxZoom: 11,                     // allow over-zoom, UI shows "Beyond data resolution" past native
      attribution: def.attribution,
      errorTileUrl: TRANSPARENT_PNG,   // missing tile = no coverage, not a crash
      updateWhenIdle: true, keepBuffer: 2,
    }).addTo(this.map);
    this.base.on('tileerror', this.handleTileError);
    this.base.on('tileload', () => { if (this.tileErrors.length) this.tileErrors.length = 0; });
  }

  /** Programmatic moves are flagged so they never echo back as user input. */
  flyTo(lat: number, lonE: number, zoom?: number) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.programmatic++;
    const target: L.LatLngTuple = [clampLat(lat), lon360ToDisplay(lonE)];
    const z = zoom ?? this.map.getZoom();
    if (reduced) this.map.setView(target, z, { animate: false });
    else this.map.flyTo(target, z, { duration: 0.8 });
  }
  fitExtent(w: number, s: number, e: number, n: number) {   // lon in display degrees
    this.programmatic++;
    this.map.fitBounds([[s, w], [n, e]], { animate: false });
  }

  setMarkers(items: MarkerDef[]) {
    const next = new Set(items.map(i => i.id));
    for (const [id, m] of this.markers) if (!next.has(id)) { this.markerGroup.removeLayer(m); this.markers.delete(id); }
    for (const it of items) {
      if (this.markers.has(it.id)) continue;
      const m = L.marker([it.lat, lon360ToDisplay(it.lonE)], {
        title: it.label, keyboard: true, riseOnHover: true,
        icon: L.divIcon({ className: 'ml-marker', html: it.html ?? '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      });
      if (it.onClick) m.on('click', it.onClick);
      m.addTo(this.markerGroup);
      this.markers.set(it.id, m);
    }
  }

  /** segments: array of {points:[lat,lonE][], flag:'ok'|'steep'|'nodata'} */
  setRoute(segments: { points: [number, number][]; flag: 'ok' | 'steep' | 'nodata' }[]) {
    this.routeLayer.clearLayers();
    const style = {
      ok:     { color: '#4CAF7A', weight: 4 },
      steep:  { color: '#F2B84B', weight: 4, dashArray: '8 6' },
      nodata: { color: '#9AA3AD', weight: 4, dashArray: '2 8' },
    } as const;
    for (const s of segments)
      L.polyline(s.points.map(([la, lo]) => [la, lon360ToDisplay(lo)] as L.LatLngTuple), style[s.flag]).addTo(this.routeLayer);
  }

  invalidateSize() { this.map.invalidateSize({ animate: false }); }
  get leaflet() { return this.map; }     // escape hatch for controls; do not call setView from components

  destroy() {                            // StrictMode-safe: called from effect cleanup
    this.ro?.disconnect();
    window.clearTimeout(this.vpTimer);
    this.map.off(); this.map.remove();
  }

  // ---- internals ----
  private handleMoveEnd = () => {
    const now = performance.now();
    this.moveTimes = this.moveTimes.filter(t => now - t < 1000); this.moveTimes.push(now);
    if (import.meta.env.DEV && this.moveTimes.length > 20) { console.error('MAP LOOP DETECTED'); this.map.off('moveend', this.handleMoveEnd); return; }

    const source: Viewport['source'] = this.programmatic > 0 ? 'app' : 'ui';
    if (this.programmatic > 0) this.programmatic--;
    window.clearTimeout(this.vpTimer);
    this.vpTimer = window.setTimeout(() => {
      const c = this.map.getCenter();
      this.o.onViewport?.({ lat: c.lat, lonE: displayToLon360(c.lng), zoom: this.map.getZoom(), source });
    }, 200);
  };

  private handleTileError = () => {
    const now = Date.now();
    this.tileErrors = this.tileErrors.filter(t => now - t < 10_000); this.tileErrors.push(now);
    if (this.tileErrors.length >= 5 && !this.fallback && this.o.fallbackImageUrl) {
      this.fallback = L.imageOverlay(this.o.fallbackImageUrl, WORLD, { opacity: 1, interactive: false }).addTo(this.map);
      this.fallback.bringToBack();
      this.o.onBackendDegraded?.(true);      // UI shows "Cached basemap — detailed tiles unavailable"
    }
  };
}
```
Design rules baked in: map built **once**; one debounced viewport callback; programmatic moves are flagged `source:'app'`; no component may call `setView` directly.

**Caution on `programmatic` counter:** `flyTo` with animation emits several `moveend`-adjacent events in some Leaflet versions. If the counter drifts in testing, replace it with a timestamp window (`this.ignoreUntil = performance.now() + 1200`). Test that case explicitly.

### 4.5 Mars-correct distance and scale
`L.CRS.EPSG4326` inherits **Earth** distance maths (`map.distance`, `L.control.scale`, `L.Polyline` length helpers). On Mars these are wrong by ~6371/3389.5 ≈ 1.88×.
- Never call `map.distance()` or `latLng.distanceTo()`; use `haversineKm`.
- Replace `L.control.scale` with a custom control:
```ts
// src/map/MarsScale.ts
import L from 'leaflet';
import { haversineKm } from '../core/geo';
export const MarsScale = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd(map: L.Map) {
    const el = L.DomUtil.create('div', 'ml-scale');
    const update = () => {
      const y = map.getSize().y / 2, a = map.containerPointToLatLng([10, y]), b = map.containerPointToLatLng([110, y]);
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      const nice = [0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000].reduce((p, c) => (c <= km ? c : p), 0.1);
      el.style.width = `${100 * nice / km}px`; el.textContent = `${nice} km`;
    };
    map.on('zoomend moveend', update); update(); return el;
  },
});
```
(100 px of horizontal scale is read at the viewport's mid-latitude row; on equirectangular maps real distance per pixel shrinks with `cos(lat)` east-west, which `haversineKm` already accounts for.)

### 4.6 `src/map/MarsMapView.tsx` (thin React shell)
```tsx
import React, { useEffect, useRef } from 'react';
import { MarsMap, type MarkerDef, type TrekLayerDef, type Viewport } from './MarsMap';

interface Props {
  layers: TrekLayerDef[];
  baseLayerId: string;
  markers: MarkerDef[];                // MUST be memoised by the caller (useMemo)
  initial: { lat: number; lonE: number; zoom: number };   // read once at mount
  onMapClick?: (p: { lat: number; lonE: number }) => void;
  onViewport?: (v: Viewport) => void;
}

export const MarsMapView: React.FC<Props> = ({ layers, baseLayerId, markers, initial, onMapClick, onViewport }) => {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MarsMap | null>(null);
  const clickRef = useRef(onMapClick); clickRef.current = onMapClick;      // stable callbacks, no effect re-runs
  const vpRef = useRef(onViewport);    vpRef.current = onViewport;

  useEffect(() => {
    const m = new MarsMap({
      container: host.current!, layers, baseLayerId, initial,
      fallbackImageUrl: import.meta.env.BASE_URL + 'tiles/fallback-global.jpg',
      onMapClick: p => clickRef.current?.(p),
      onViewport: v => vpRef.current?.(v),
    });
    map.current = m;
    return () => { m.destroy(); map.current = null; };   // StrictMode mounts twice in dev: cleanup is mandatory
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);                                                // mount-only, on purpose

  useEffect(() => { map.current?.setBaseLayer(baseLayerId); }, [baseLayerId]);
  useEffect(() => { map.current?.setMarkers(markers); }, [markers]);

  // Parent MUST give this element a real height (e.g. flex-1 min-h-0 inside a h-screen column).
  return <div ref={host} className="h-full w-full bg-[#0B0D10]" role="application" aria-label="Mars map" />;
};
```
`MapPage` rules: wrap marker arrays in `useMemo`; never put `viewport` in the dependency list of an effect that moves the map; use `mapRef.flyTo()` from click handlers only (search result chosen, checkpoint chosen).

### 4.7 Leaflet CSS and icons
`main.tsx` already imports `leaflet/dist/leaflet.css`. Remove any `<link>` to a CDN Leaflet stylesheet in `index.html` (double CSS causes odd tile/marker offsets). Because markers use `divIcon`, Leaflet's default PNG marker-icon path bug in Vite is avoided.

---

## 5. Layers: from NASA, via the probe script

### 5.1 Expected URL shape (confirmed pattern, unconfirmed per-layer names)
```
https://trek.nasa.gov/tiles/Mars/EQ/{LayerId}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{ext}
e.g. https://trek.nasa.gov/tiles/Mars/EQ/<LayerId>/1.0.0/default/default028mm/0/0/0.jpg
```
For the Viking color mosaic the catalog lists style `default`, matrix set `default028mm`, `image/jpg`, bbox −180/−90/180/90. Confirm the exact `<LayerId>` and `ResourceURL` with the probe.

### 5.2 Layers to attempt (the registry keeps only what resolves)
| Our id | Kind | Candidate layer id(s) | Status |
|---|---|---|---|
| `viking-color` | satellite | `Mars_Viking_MDIM21_ClrMosaic_global_232m`, `Viking_MDIM21_ClrMosaic_global_232m` | Both spellings seen in public sources; probe decides |
| `mola-shaded-relief` | elevation | look for the MOLA colour-shade product in the Trek Mars list at `trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars` | Name **not** confirmed here |
| `hirise-site`, `hrsc`, `moc` | satellite (regional) | from the same Trek list, if present | Regional coverage only |

### 5.3 Zoom arithmetic (estimate only)
Mars ≈ 59.3 km/degree. A 232 m/px mosaic ≈ 256 px/degree. At TileMatrix *m* a 256-px tile spans 180/2^m degrees, i.e. 256·2^m/180 px/deg → native matches at m ≈ 7–8. Treat as a sanity range for the probe, **not** as the value to hard-code.

### 5.4 `public/data/layers.json` (output shape)
```jsonc
{
  "generatedAt": "2026-11-15T00:00:00Z",
  "layers": [{
    "id": "viking-color",
    "title": "Viking Color Mosaic (global, 232 m)",
    "kind": "satellite",
    "urlTemplate": "https://trek.nasa.gov/tiles/Mars/EQ/<resolved>/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
    "maxMatrix": 0,             // filled by probe
    "ext": "jpg",
    "bbox": [-180, -90, 180, 90],
    "attribution": "NASA/JPL/USGS · Mars Trek",
    "provenance": "NASA-DERIVED",
    "verifiedOn": "<probe date>"
  }]
}
```
The app loads this file through `safeFetch` (live → cache → fixture); a committed copy is the fixture.

---

## 6. `scripts/probe-trek.ts` (Node 20+, run: `npx tsx scripts/probe-trek.ts`)
Requires internet. It does **not** invent anything: it writes only layers whose tiles actually return image bytes.

```ts
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://trek.nasa.gov/tiles/Mars/EQ';
const CANDIDATES = [
  { id: 'viking-color', title: 'Viking Color Mosaic (global, 232 m)', kind: 'satellite',
    names: ['Mars_Viking_MDIM21_ClrMosaic_global_232m', 'Viking_MDIM21_ClrMosaic_global_232m'] },
  // Add MOLA / HiRISE / HRSC names copied from trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars
];

const tileXY = (lat: number, lon: number, m: number) => {          // lon in −180..180
  const deg = 180 / 2 ** m;
  return { col: Math.floor((lon + 180) / deg), row: Math.floor((90 - lat) / deg) };
};
const isImage = async (url: string) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'); } catch { return false; }
};

async function resolve(name: string, ext: string) {
  const tpl = (m: number, r: number, c: number) => `${BASE}/${name}/1.0.0/default/default028mm/${m}/${r}/${c}.${ext}`;
  if (!(await isImage(tpl(0, 0, 0)))) return null;
  // Gale-region point from the Trek link (lat −6.5435, lon 137.1817) — present in any global product.
  let max = 0;
  for (let m = 1; m <= 14; m++) {
    const { row, col } = tileXY(-6.5435, 137.1817, m);
    if (await isImage(tpl(m, row, col))) max = m; else break;
  }
  return { max, template: `${BASE}/${name}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}` };
}

const out: any[] = [];
for (const c of CANDIDATES) {
  for (const name of c.names) for (const ext of ['jpg', 'png']) {
    const r = await resolve(name, ext);
    if (r) { out.push({ id: c.id, title: c.title, kind: c.kind, urlTemplate: r.template, maxMatrix: r.max, ext,
                        bbox: [-180, -90, 180, 90], attribution: 'NASA/JPL/USGS · Mars Trek',
                        provenance: 'NASA-DERIVED', verifiedOn: new Date().toISOString().slice(0, 10) });
             console.log('OK  ', name, ext, 'maxMatrix', r.max); break; }
    else console.log('MISS', name, ext);
  }
}
if (!out.length) { console.error('No Trek layer resolved. Check network / layer names.'); process.exit(1); }
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/layers.json', JSON.stringify({ generatedAt: new Date().toISOString(), layers: out }, null, 2));
```
Limits the agent must respect: the loop stops at the first missing matrix (if a layer skips a zoom level it under-reports; fall back to reading `TileMatrix` ids from `WMTSCapabilities.xml`). For regional layers (HiRISE/HRSC), probe a point **inside** the layer's `ows:WGS84BoundingBox`, not the Gale point.

Also create `public/tiles/fallback-global.jpg` once (4096×2048): download the USGS Viking colorized global mosaic (232 m, from `astrogeology.usgs.gov`/`planetarymaps.usgs.gov`) and downsample, or stitch Trek matrix-4 tiles. Record the source in `docs/DATA_PROVENANCE.md`.

---

## 7. Terrain details, routes and "every map detail": what to use

Trek's website offers interactive terrain/route tools, but this research found **no public API** for them. Do not scrape Trek's web UI. Use:

| Need | Source | How |
|---|---|---|
| Imagery | Trek WMTS tiles | Section 5 |
| Elevation / slope / roughness | **USGS MGS MOLA DEM 463 m** (`Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`) | Build-time ETL → static binary → browser sampler (spec §8.4). **Terrain readout (cursor + report) comes from here, not Trek.** |
| Routes | Own A* worker over the DEM (spec §9.4) | Unknown cells impassable by default; draw with `MarsMap.setRoute` flags `ok/steep/nodata` |
| Hazards / checkpoints | `public/data/checkpoints.json` (spec §6) | Markers + zones; RSL are **not** a water resource |
| Cross-check with NASA's own tools | `trekDeepLink()` | "Open this view in Mars Trek" button |

State the limit in the UI: **463 m DEM cannot resolve rover-scale hazards; slope/roughness are regional indicators.**

Cursor readout (needed on the map): `lat / lonE / lonDisplay / elevation (m, MOLA, NASA-DERIVED) / slope` updated on `mousemove` throttled to 100 ms; show `—` (never `0`) where the DEM isn't loaded yet.

---

## 8. Map features checklist (all must work)
- Base-layer radio list from `layers.json`; the layer panel must show layer name, resolution, source, verified date, and a `LIVE`/`CACHED`/`FIXTURE` badge.
- Overlays: checkpoints (cluster with `leaflet.markercluster` only after the basic map is stable), planned route, graticule every 30° (draw with `L.polyline`, display-lon), Mars scale bar, cursor readout.
- Search box + "Go to coordinates" (parser in spec §8.2) → `flyTo`.
- Click → Location Report drawer with a pulsing marker; selected id is in the URL hash (`#/map?lat=..&lon=..`).
- Zoom past `maxNativeZoom` → badge "Beyond data resolution", no extra tile requests.
- Toolbar: zoom in/out, reset view, **Open in Mars Trek**, fullscreen.
- Keyboard: arrow keys pan, `+/-` zoom, `Tab` reaches markers and toolbar; focus ring uses `--lantern-glow`. `prefers-reduced-motion` → no `flyTo` animation (already in `MarsMap.flyTo`).
- No horizontal overflow at 360 px; touch targets ≥ 44 px.

---

## 9. Vite / deployment bits that affect the map
- `vite.config.ts`: `base: process.env.VITE_BASE ?? '/'` (spec §13.2). A hard-coded repo base breaks `fetch(BASE_URL + 'data/layers.json')` after a rename.
- Fetch local data with `import.meta.env.BASE_URL + 'data/...'`, never `/data/...`.
- Trek tiles are loaded as `<img>`; no CORS setup is needed for display. Anything that **reads pixels** (canvas) from Trek tiles would need CORS: avoid it. Elevation always comes from your own static DEM.
- Use `https://` URLs only (GitHub Pages is https; http tiles would be blocked as mixed content).
- GitHub Pages SPA fallback: `cp dist/index.html dist/404.html` (HashRouter already avoids most 404 problems).

---

## 10. Acceptance tests (release gate for the map)

**Automated (Vitest):**
1. `geo.ts`: `lon360ToDisplay(226.2) === -133.8`; `normalizeLon360(-10) === 350`; `haversineKm(0,0,0,90) ≈ 5324.4` (¼ of 2π·3389.5 km).
2. Tile math: matrix 0 → 2 cols × 1 row; matrix *m* → `2^(m+1)` × `2^m`.
3. `MarsMap` in jsdom is awkward; instead unit-test the pure helpers and keep a Playwright smoke test (below).

**Playwright smoke (`npx playwright test`):**
- Load `#/map`; wait 5 s; assert no console error containing `MAP LOOP DETECTED` or `Maximum update depth`.
- Count `moveend` via `window.__moveCount` (dev-only counter) over 5 idle seconds: must be **0**.
- Drag the map hard left 20 times: `map.getCenter().lng` must stay ≥ −180 and the number of `.leaflet-marker-icon` for a given checkpoint id must be **1**.
- Block `trek.nasa.gov` (route abort): the fallback image appears and the banner text is visible.

**Manual calibration (blocks release):**
| # | Check | Expected |
|---|---|---|
| 1 | Open the map at lat −6.5435, lonE 137.1817 with extent W136.30 S−6.98 E138.06 N−6.11 | Same features as your Trek link, side-by-side |
| 2 | Marker at Olympus Mons summit ≈ 18.65°N, 226.2°E (display −133.8) | On the volcano |
| 3 | Marker at Jezero ≈ 18.44°N, 77.45°E | In Jezero crater |
| 4 | Marker at Bradbury Landing ≈ 4.59°S, 137.44°E | In Gale crater |
| 5 | Pan to every edge and corner | Hard stop, no repeat |
| 6 | Zoom from min to max | Detail increases, no tile mis-registration (if it jumps by 2× at one zoom step, revisit `zoomOffset`) |
| 7 | Scale bar across 10° of equator | ≈ 593 km (59.3 km/° × 10) |
| 8 | DevTools Performance, idle 10 s | No repeating scripting tasks |

If checks 2–4 are off by more than ~1°, the longitude convention is wrong (see `geo.ts`).

---

## 11. Common failure table

| Symptom | Likely cause | Fix |
|---|---|---|
| Grey map, tiles never appear | Container has 0 height | Give parent a real height; call `invalidateSize()` (ResizeObserver already does) |
| World repeats sideways | `noWrap` missing / default CRS | §4.4 options |
| Tiles blank, console 404s | Wrong layer id or matrix too deep | Re-run probe; lower `maxMatrix` |
| Image is half/double the expected scale | `zoomOffset` or `minZoom` wrong | §4.2 |
| Mirror-flipped north/south | `tms: true` set | Remove it |
| Markers 180° or 360° off | Using 0–360 lon directly in Leaflet | Always go through `lon360ToDisplay` |
| "Map container is already initialized" | StrictMode double mount without cleanup | `destroy()` in effect cleanup (§4.6) |
| Map jumps back after panning | An effect calls `setView` from viewport state | Remove it; only handlers call `flyTo` |
| Distances ≈ 1.88× too large | Leaflet Earth radius | §4.5 |
| Works locally, blank on GitHub Pages | Absolute `/data/...` path or wrong `base` | `import.meta.env.BASE_URL`, `VITE_BASE` |

---

## 12. Prompt for Antigravity (paste this)

```
PROJECT: MARS LANTERN — MAP FIX ONLY
Read docs/MAP_FIX_SPEC.md and MARS_LANTERN_SPEC.md first. Then inspect src/ (MapPage and any map components were not shared with the spec author).
Stack: React 18, TypeScript strict, Vite, Tailwind, Leaflet 1.9. Do not add another map framework. Do not rewrite unrelated pages.

ORDER OF WORK (commit after each step; run `npm run build` and tests between steps):
M0  Run the diagnosis in spec §3. Write docs/MAP_LOOP_ROOT_CAUSE.md with real evidence (grep output, what you observed). Report before fixing.
M1  Create src/core/geo.ts + tests (§4.3, §10 automated 1). 
M2  Run scripts/probe-trek.ts (§6). Commit public/data/layers.json only with layers that actually resolved. If the network is blocked, say so and stop; do not invent layer ids or maxMatrix.
M3  Build src/map/MarsMap.ts, MarsMapView.tsx, MarsScale.ts (§4.4–4.6). Replace the current map on /map. Remove any CDN Leaflet CSS from index.html.
M4  Fallback basemap + degraded banner (§4.4 handleTileError, §6).
M5  Markers from checkpoints.json (migrate existing hazards/rover data, do not retype), cursor readout, graticule, Open-in-Trek button (§1, §8).
M6  Routes: draw via setRoute with ok/steep/nodata flags; routing logic itself is in the Web Worker per spec §9.4.
M7  Playwright smoke + manual calibration table (§10). Paste real outputs.

HARD RULES
- The map is created once and destroyed in effect cleanup. No component calls setView/fitBounds in an effect.
- CRS L.CRS.EPSG4326, noWrap, maxBounds, maxBoundsViscosity 1, worldCopyJump false, zoomOffset -1, minZoom 1.
- Never use Leaflet distance helpers or L.control.scale (Earth radius). Use haversineKm with 3389.5 km.
- Never fabricate NASA layer ids, tile zoom limits, coordinates or values. Unknown stays UNKNOWN.
- Every number shown carries a provenance badge (MEASURED / NASA-DERIVED / MODELED / SIMULATED / UNKNOWN).
- RSL are not a water resource.
- Do not claim a fix works until you have run it; report the actual command output.

FINISH: list changed files, state what was verified vs not (especially the zoomOffset/calibration results), paste test/build output, and give the start command (npm run dev).
```

---

## 13. Known limits to show in the app
- Trek tile availability depends on NASA servers; the fallback basemap is lower resolution.
- MOLA 463 m terrain cannot resolve rocks, small scarps or dunes.
- Regional layers (HiRISE/HRSC) exist only where the layer's bounding box says so; missing tiles mean no coverage.
- Routes are planning aids computed from coarse data, not validated rover-drive paths.

*End of map-fix specification.*
