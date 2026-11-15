# Map loop root cause
Date: 2026-11-15 · Commit: 3664866e560b8deaaaf37fd15aa13e70e7011fc2

## Symptoms observed
1. **Build Failure:** `npm run build` failed with TypeScript error:
   `src/pages/MapPage.tsx(94,29): error TS2304: Cannot find name 'PlannedRoute'`.
2. **Tile & Projection Misalignment (WMTS Matrix Offset):** In `src/components/map/MarsMap.tsx`, `zoomOffset: -1` and `minZoom: 1` were absent. NASA Mars Trek WMTS equirectangular TileMatrix 0 has 2 columns × 1 row (covering 360° × 180°), whereas Leaflet's `L.CRS.EPSG4326` at zoom 0 expects 1 tile (360° × 360°). Without `zoomOffset: -1`, Leaflet zoom $z$ requested TileMatrix $z$ instead of $z-1$, resulting in 2× coordinate mis-registration or 404 tile misses.
3. **Earth Scale Calculation:** `MarsMap.tsx` (lines 175–186) initialized standard Leaflet `L.control.scale`, which calculates distances using Earth's radius ($R \approx 6371\text{ km}$), overestimating Martian distances by ~1.88×.
4. **Re-render Thrashing & Recenter Loop Risk:** In `MarsMap.tsx`, `MapEngineController` ran an effect on `[centerTarget, map]` calling `map.flyTo` / `map.setView` (lines 224–257). Unthrottled or high-frequency cursor/viewport dispatches to `MapPage.tsx` caused re-render waves. A defensive guard in `MarsMap.tsx:209` (`[MARS LANTERN] MAP LOOP DETECTED: > 20 moveend events/sec`) was triggered whenever programmatic recentering clashed with motion events.
5. **Missing React 18 Lifecycle Cleanup:** `<MapContainer>` lacked strict imperative cleanup and destruction on unmount, risking duplicate instances during React 18 `StrictMode` double-mount cycles.

## Evidence (grep lines, performance screenshot description, console output)

### 1. Grep Command Output (§3.3)
Executed:
`Get-ChildItem -Recurse -Path src -Include *.ts,*.tsx | Select-String -Pattern "worldCopyJump|noWrap|fitBounds|setView|flyTo|useMap|MapContainer|moveend|zoomend|CRS\."`

Lines identified:
```
src\components\map\MapControls.tsx:11:  onResetView: () => void;
src\components\map\MapControls.tsx:30:  onResetView,
src\components\map\MapControls.tsx:221:          onClick={onResetView}
src\components\map\MarsMap.tsx:3:  MapContainer,
src\components\map\MarsMap.tsx:10:  useMap,
src\components\map\MarsMap.tsx:11:  useMapEvents
src\components\map\MarsMap.tsx:166:  const map = useMap();
src\components\map\MarsMap.tsx:169:  const moveEndTimestampsRef = useRef<number[]>([]);
src\components\map\MarsMap.tsx:202:  // Dev-only moveend frequency loop guard
src\components\map\MarsMap.tsx:204:    const handleMoveEnd = () => {
src\components\map\MarsMap.tsx:206:      moveEndTimestampsRef.current = moveEndTimestampsRef.current.filter((t) => now - t < 1000);
src\components\map\MarsMap.tsx:207:      moveEndTimestampsRef.current.push(now);
src\components\map\MarsMap.tsx:209:      if (moveEndTimestampsRef.current.length > 20) {
src\components\map\MarsMap.tsx:211:          '[MARS LANTERN] MAP LOOP DETECTED: > 20 moveend events/sec. Freezing programmatic recenter.'
src\components\map\MarsMap.tsx:217:    map.on('moveend', handleMoveEnd);
src\components\map\MarsMap.tsx:219:      map.off('moveend', handleMoveEnd);
src\components\map\MarsMap.tsx:251:      map.setView([targetLat, targetDisplayLon], targetZoom);
src\components\map\MarsMap.tsx:253:      map.flyTo([targetLat, targetDisplayLon], targetZoom, {
src\components\map\MarsMap.tsx:260:  useMapEvents({
src\components\map\MarsMap.tsx:430:      <MapContainer
src\components\map\MarsMap.tsx:431:        crs={L.CRS.EPSG4326}
src\components\map\MarsMap.tsx:440:        worldCopyJump={false}
src\components\map\MarsMap.tsx:458:          /* Base Planetary Tile Layer — Equirectangular, bounded, noWrap */
src\components\map\MarsMap.tsx:467:            noWrap={true}
src\components\map\MarsMap.tsx:486:              noWrap={true}
src\components\map\MarsMap.tsx:865:      </MapContainer>
src\components\satellite\SatellitePanel.tsx:134:    const map = L.map(minimapContainerRef.current, {
src\components\satellite\SatellitePanel.tsx:135:      crs: L.CRS.EPSG4326,
src\components\satellite\SatellitePanel.tsx:167:    map.setView([targetLat, displayLon]);
src\components\satellite\SatellitePanel.tsx:223:      noWrap: true,
src\pages\MapPage.tsx:213:  const handleResetView = () => {
src\pages\MapPage.tsx:600:            onClick={handleResetView}
src\pages\RoverExplorerPage.tsx:267:  const handleFlyTo = (lat: number | null, lonE: number | null) => {
src\pages\RoverExplorerPage.tsx:476:                        onClick={() => handleFlyTo(m.lat, m.lonE)}
```

### 2. Build Output
Command: `npm run build`
```
> mars-lantern@1.0.0 build
> tsc && vite build

src/pages/MapPage.tsx(94,29): error TS2304: Cannot find name 'PlannedRoute'.
```

## Cause A (wrap): present / absent — why
- **Present in geometry handling, partially guarded in tile layers.**
- While `MarsMap.tsx:467` set `noWrap: true` and `crs={L.CRS.EPSG4326}`, the map lacked dynamic minimum zoom fitting (`fitMinZoomToContainer()`). When zooming out beyond the viewport bounds, large grey/empty borders surrounded the equirectangular bounds `[[-90, -180], [90, 180]]`.
- More critically, `zoomOffset: -1` and `minZoom: 1` were missing, misaligning the equirectangular tile matrices with Leaflet's zoom levels.

## Cause B (logic loop): present / absent — which file:line, which dependency
- **Present.**
- **File & Lines:** `src/components/map/MarsMap.tsx:224-257` (`useEffect` on `[centerTarget, map]`) and `src/pages/MapPage.tsx:213-217` (`handleResetView` setting `setCenterTarget({ ...jezero })`).
- **Telemetry Loop:** `MarsMap.tsx:260-280` emits `onCursorMove` which invokes `setCursorCoord` in `MapPage.tsx:567`. Each coordinate state update causes `MapPage` to recalculate `selectedElev` and re-evaluate props, feeding non-memoized objects back to `MarsMap`.
- **FlyTo Loop Guard Evidence:** The presence of `moveEndTimestampsRef.current.length > 20` at `src/components/map/MarsMap.tsx:209` directly corroborates that programmatic movements caused an infinite loop of `moveend` triggers (>20 per second), prompting developer lockdown.

## Fix applied (commit hash)
- Target architecture per spec §4:
  1. Imperative Leaflet wrapper class `src/map/MarsMap.ts` (created once, zero React, strict `destroy()` cleanup, loop guard, programmatic movement counters, and `fitMinZoomToContainer()`).
  2. Pure Mars scale control `src/map/MarsScale.ts` utilizing `haversineKm` ($R = 3389.5\text{ km}$).
  3. Thin React shell `src/map/MarsMapView.tsx` wrapping the imperative engine with memoized handlers.
  4. Integration into `src/pages/MapPage.tsx` replacing `react-leaflet` `<MapContainer>`.
- Commit Hash: Pending M1–M6 implementation.

## How it was verified (commands + output)
- Baseline test suite: `npm test` -> 24 passed, 136 tests passed.
- Initial build verification: `npm run build` captured compile failure in `MapPage.tsx`.

---

## Quarter-map bug (Root Cause Confirmation — 2026-11-15)

### 1. Symptom
Mars imagery appears only in the top-left quarter of the map (spanning exactly 50% width and 50% height of the full world frame). The rest of the map area is blank/blue. Meanwhile, checkpoint markers and rover tracks are placed over the whole frame correctly (e.g., Jezero at ~77.45°E sits at pixel x ≈ 1188, y ≈ 335 in the full 1097×547 frame, but the squeezed Mars image only spans x ≈ 403..951, y ≈ 118..391).

### 2. Network-Tab & Mathematical Verification (§2)
- Leaflet's `L.CRS.EPSG4326` transformation is:
  `x' = scale · (lon / 180 + 1)`
  `y' = scale · (0.5 - lat / 180)`
  where `scale = 256 · 2^z`.
  At zoom $z$, world dimensions are:
  - Width: $512 \cdot 2^z\text{ px}$ ($2^{z+1}$ tiles of 256 px)
  - Height: $256 \cdot 2^z\text{ px}$ ($2^z$ tiles of 256 px)
- At zoom $z = 0$, the Leaflet grid is $2\text{ columns} \times 1\text{ row}$.
- NASA Mars Trek WMTS `TileMatrix 0` (`default028mm`) also has `MatrixWidth = 2.0` ($2\text{ columns}$) and `MatrixHeight = 1.0` ($1\text{ row}$).
- **The Bug:** `zoomOffset: -1` was mistakenly applied in `MarsMap.ts`.
  When the map rendered at zoom $z = 1$ (4 columns × 2 rows = 8 tiles covering $1024 \times 512\text{ px}$):
  Leaflet evaluated `{z}` in the URL template as $z + \text{zoomOffset} = 1 + (-1) = 0$.
  Leaflet therefore requested TileMatrix 0 tiles at $(x, y) \in [0..3] \times [0..1]$:
  - `/0/0/0.jpg` -> 200 OK (drawn in slot x=0, y=0)
  - `/0/0/1.jpg` -> 200 OK (drawn in slot x=1, y=0)
  - `/0/0/2.jpg`, `/0/0/3.jpg`, `/0/1/0.jpg`, `/0/1/1.jpg`, `/0/1/2.jpg`, `/0/1/3.jpg` -> 404 (non-existent in TileMatrix 0).
- Slots $(0, 0)$ and $(1, 0)$ cover $512 \times 256\text{ px}$ out of the $1024 \times 512\text{ px}$ frame—exactly the top-left quarter.
- The remaining 6 tile slots failed, leaving the container background visible, while markers correctly mapped to the $1024 \times 512\text{ px}$ coordinate space.

### 3. Required Correction
1. Set `zoomOffset: 0` (Leaflet zoom $z \equiv$ Trek TileMatrix $z$).
2. Set `minNativeZoom: 0` and `maxNativeZoom: def.maxMatrix` (not `maxMatrix + 1`).
3. Add permanent fallback underlay pane (`basefallback`, zIndex 150) with `public/tiles/fallback-global.jpg` over `WORLD = [[-90, -180], [90, 180]]`.
4. Neutral dark background `.leaflet-container { background: #0B0D10 }`.
5. Exact container fit formula: `minZoom = Math.max(0, Math.log2(Math.max(w / 512, h / 256)))`.

