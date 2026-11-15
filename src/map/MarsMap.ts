/**
 * MARS LANTERN — Imperative Leaflet Mars Map Wrapper
 * 
 * Manages Leaflet map instance with Martian Equirectangular CRS (L.CRS.EPSG4326),
 * NASA Mars Trek WMTS tile matrix alignment (zoomOffset: -1, minZoom: 1),
 * strict world bounds [-90, -180]..[90, 180], noWrap, and Mars-radius scale.
 * 
 * Pure TypeScript (no React, no hooks, StrictMode-safe destroy).
 * Reference: docs/MAP_FIX_SPEC.md §4.4
 */

import L from 'leaflet';
import { lon360ToDisplay, displayToLon360, clampLat } from '../core/geo';
import { MarsScale } from './MarsScale';

export const MARS_WORLD_BOUNDS = L.latLngBounds([-90, -180], [90, 180]);
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface TrekLayerDef {
  id: string;
  title: string;
  urlTemplate: string;
  maxMatrix: number;
  attribution: string;
  kind?: string;
  ext?: string;
}

export interface Viewport {
  lat: number;
  lonE: number;
  zoom: number;
  source: 'ui' | 'app';
}

export interface MarkerDef {
  id: string;
  lat: number;
  lonE: number;
  label: string;
  html?: string;
  onClick?: () => void;
}

export interface MarsMapOptions {
  container: HTMLElement;
  layers: TrekLayerDef[];
  baseLayerId: string;
  initial?: { lat: number; lonE: number; zoom: number };
  fallbackImageUrl?: string;
  onViewport?: (v: Viewport) => void;
  onMapClick?: (p: { lat: number; lonE: number }) => void;
  onCursorMove?: (p: { lat: number; lonE: number; displayLon: number }) => void;
  onBackendDegraded?: (degraded: boolean) => void;
  showGraticule?: boolean;
}

export class MarsMap {
  private map: L.Map;
  private layers: Map<string, TrekLayerDef>;
  private base?: L.TileLayer;
  private markerGroup = L.layerGroup();
  private markers = new Map<string, L.Marker>();
  private routeLayer = L.layerGroup();
  private graticuleLayer = L.layerGroup();
  private fallback?: L.ImageOverlay;
  private programmatic = 0;
  private ignoreUntil = 0;
  private tileErrors: number[] = [];
  private moveTimes: number[] = [];
  private vpTimer?: number;
  private mouseMoveTimer?: number;
  private ro?: ResizeObserver;

  constructor(private o: MarsMapOptions) {
    this.layers = new Map(o.layers.map((l) => [l.id, l]));
    const init = o.initial ?? { lat: 0, lonE: 0, zoom: 2 };

    this.map = L.map(o.container, {
      crs: L.CRS.EPSG4326,
      minZoom: 1,
      maxZoom: 11,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      maxBounds: MARS_WORLD_BOUNDS,
      maxBoundsViscosity: 1.0,
      worldCopyJump: false,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true
    });

    this.map.setView([init.lat, lon360ToDisplay(init.lonE)], init.zoom, { animate: false });

    // Expose for debugging & Playwright assertions
    if (typeof window !== 'undefined') {
      (window as any).__marsMap = this.map;
    }

    this.graticuleLayer.addTo(this.map);
    this.markerGroup.addTo(this.map);
    this.routeLayer.addTo(this.map);

    // Planetary scale control
    new (MarsScale as any)().addTo(this.map);

    if (o.showGraticule !== false) {
      this.initGraticule();
    }

    this.setBaseLayer(o.baseLayerId);
    this.fitMinZoomToContainer();

    this.map.on('click', (e: L.LeafletMouseEvent) =>
      this.o.onMapClick?.({
        lat: clampLat(e.latlng.lat),
        lonE: displayToLon360(e.latlng.lng)
      })
    );

    this.map.on('mousemove', this.handleMouseMove);
    this.map.on('moveend', this.handleMoveEnd);

    this.ro = new ResizeObserver(() => {
      this.map.invalidateSize({ animate: false });
      this.fitMinZoomToContainer();
    });
    this.ro.observe(o.container);
  }

  /** The world must always fill the container: no grey margins, no empty wrap area. */
  private fitMinZoomToContainer() {
    if (!this.map) return;
    const z = Math.max(1, this.map.getBoundsZoom(MARS_WORLD_BOUNDS, true));
    this.map.setMinZoom(z);
    if (this.map.getZoom() < z) {
      this.map.setZoom(z, { animate: false });
    }
  }

  setBaseLayer(id: string) {
    const def = this.layers.get(id);
    if (!def) return;

    if (this.base) {
      this.map.removeLayer(this.base);
    }

    this.base = L.tileLayer(def.urlTemplate, {
      tileSize: 256,
      noWrap: true,
      bounds: MARS_WORLD_BOUNDS,
      zoomOffset: -1,
      minNativeZoom: 1,
      maxNativeZoom: def.maxMatrix + 1,
      maxZoom: 11,
      attribution: def.attribution,
      errorTileUrl: TRANSPARENT_PNG,
      updateWhenIdle: true,
      keepBuffer: 2
    }).addTo(this.map);

    this.base.on('tileerror', this.handleTileError);
    this.base.on('tileload', () => {
      if (this.tileErrors.length) this.tileErrors.length = 0;
    });
  }

  flyTo(lat: number, lonE: number, zoom?: number) {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    this.programmatic++;
    this.ignoreUntil = performance.now() + 1200;
    const target: L.LatLngTuple = [clampLat(lat), lon360ToDisplay(lonE)];
    const z = zoom ?? this.map.getZoom();

    if (reduced) {
      this.map.setView(target, z, { animate: false });
    } else {
      this.map.flyTo(target, z, { duration: 0.8 });
    }
  }

  fitExtent(w: number, s: number, e: number, n: number) {
    this.programmatic++;
    this.ignoreUntil = performance.now() + 1200;
    this.map.fitBounds(
      [
        [s, w],
        [n, e]
      ],
      { animate: false }
    );
  }

  setMarkers(items: MarkerDef[]) {
    const next = new Set(items.map((i) => i.id));
    for (const [id, m] of this.markers) {
      if (!next.has(id)) {
        this.markerGroup.removeLayer(m);
        this.markers.delete(id);
      }
    }

    for (const it of items) {
      const displayLng = lon360ToDisplay(it.lonE);
      const existing = this.markers.get(it.id);
      if (existing) {
        existing.setLatLng([it.lat, displayLng]);
        continue;
      }

      const m = L.marker([it.lat, displayLng], {
        title: it.label,
        keyboard: true,
        riseOnHover: true,
        icon: L.divIcon({
          className: 'ml-marker',
          html: it.html ?? '<span class="ml-marker-dot"></span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      });

      if (it.onClick) {
        m.on('click', it.onClick);
      }
      m.addTo(this.markerGroup);
      this.markers.set(it.id, m);
    }
  }

  /** segments: array of {points:[lat,lonE][], flag:'ok'|'steep'|'nodata'} */
  setRoute(segments: { points: [number, number][]; flag: 'ok' | 'steep' | 'nodata' }[]) {
    this.routeLayer.clearLayers();
    const style = {
      ok: { color: '#4CAF7A', weight: 4 },
      steep: { color: '#F2B84B', weight: 4, dashArray: '8 6' },
      nodata: { color: '#9AA3AD', weight: 4, dashArray: '2 8' }
    } as const;

    for (const s of segments) {
      if (!s.points || s.points.length < 2) continue;
      const latLngs = s.points.map(
        ([la, lo]) => [la, lon360ToDisplay(lo)] as L.LatLngTuple
      );
      L.polyline(latLngs, style[s.flag]).addTo(this.routeLayer);
    }
  }

  private initGraticule() {
    this.graticuleLayer.clearLayers();
    const lineStyle: L.PolylineOptions = {
      color: 'rgba(231, 225, 216, 0.15)',
      weight: 1,
      dashArray: '4 8',
      interactive: false
    };

    // Parallels every 30 degrees (-60 to 60)
    for (let lat = -60; lat <= 60; lat += 30) {
      L.polyline(
        [
          [lat, -180],
          [lat, 180]
        ],
        lineStyle
      ).addTo(this.graticuleLayer);
    }

    // Meridians every 30 degrees (-180 to 180)
    for (let lon = -180; lon <= 180; lon += 30) {
      L.polyline(
        [
          [-90, lon],
          [90, lon]
        ],
        lineStyle
      ).addTo(this.graticuleLayer);
    }
  }

  setGraticuleVisible(visible: boolean) {
    if (visible) {
      if (!this.map.hasLayer(this.graticuleLayer)) {
        this.graticuleLayer.addTo(this.map);
      }
    } else {
      if (this.map.hasLayer(this.graticuleLayer)) {
        this.map.removeLayer(this.graticuleLayer);
      }
    }
  }

  zoomIn() {
    this.map.zoomIn();
  }

  zoomOut() {
    this.map.zoomOut();
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  invalidateSize() {
    this.map.invalidateSize({ animate: false });
  }

  get leaflet() {
    return this.map;
  }

  destroy() {
    this.ro?.disconnect();
    window.clearTimeout(this.vpTimer);
    window.clearTimeout(this.mouseMoveTimer);
    this.map.off();
    this.map.remove();
  }

  // ---- internals ----
  private handleMouseMove = (e: L.LeafletMouseEvent) => {
    if (!this.o.onCursorMove) return;
    if (this.mouseMoveTimer) return;

    this.mouseMoveTimer = window.setTimeout(() => {
      this.mouseMoveTimer = undefined;
      const lat = clampLat(e.latlng.lat);
      const displayLon = e.latlng.lng;
      const lonE = displayToLon360(displayLon);
      this.o.onCursorMove?.({ lat, lonE, displayLon });
    }, 100);
  };

  private handleMoveEnd = () => {
    // Increment smoke test counter
    if (typeof window !== 'undefined') {
      (window as any).__moveCount = ((window as any).__moveCount || 0) + 1;
    }

    const now = performance.now();
    this.moveTimes = this.moveTimes.filter((t) => now - t < 1000);
    this.moveTimes.push(now);

    if (import.meta.env.DEV && this.moveTimes.length > 20) {
      console.error('MAP LOOP DETECTED');
      this.map.off('moveend', this.handleMoveEnd);
      return;
    }

    const isProgrammatic = this.programmatic > 0 || performance.now() < this.ignoreUntil;
    const source: Viewport['source'] = isProgrammatic ? 'app' : 'ui';
    if (this.programmatic > 0) this.programmatic--;

    window.clearTimeout(this.vpTimer);
    this.vpTimer = window.setTimeout(() => {
      const c = this.map.getCenter();
      this.o.onViewport?.({
        lat: c.lat,
        lonE: displayToLon360(c.lng),
        zoom: this.map.getZoom(),
        source
      });
    }, 200);
  };

  private handleTileError = () => {
    const now = Date.now();
    this.tileErrors = this.tileErrors.filter((t) => now - t < 10_000);
    this.tileErrors.push(now);

    if (this.tileErrors.length >= 5 && !this.fallback && this.o.fallbackImageUrl) {
      this.fallback = L.imageOverlay(this.o.fallbackImageUrl, MARS_WORLD_BOUNDS, {
        opacity: 1,
        interactive: false
      }).addTo(this.map);
      this.fallback.bringToBack();
      this.o.onBackendDegraded?.(true);
    }
  };
}
