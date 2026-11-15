/**
 * MARS LANTERN — Map Smoke & Calibration Acceptance Tests (Spec §10)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Leaflet for Node-based module smoke tests (Leaflet expects window/document)
vi.mock('leaflet', () => {
  const dummyLayer = {
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    clearLayers: vi.fn(),
    removeLayer: vi.fn(),
    setLatLng: vi.fn()
  };
  return {
    default: {
      CRS: { EPSG4326: {} },
      latLngBounds: vi.fn().mockReturnValue({}),
      map: vi.fn().mockReturnValue({
        setView: vi.fn(),
        fitBounds: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        remove: vi.fn(),
        setMinZoom: vi.fn(),
        getZoom: vi.fn().mockReturnValue(2),
        getBoundsZoom: vi.fn().mockReturnValue(1),
        invalidateSize: vi.fn()
      }),
      tileLayer: vi.fn().mockReturnValue(dummyLayer),
      layerGroup: vi.fn().mockReturnValue(dummyLayer),
      marker: vi.fn().mockReturnValue(dummyLayer),
      polyline: vi.fn().mockReturnValue(dummyLayer),
      divIcon: vi.fn().mockReturnValue({}),
      imageOverlay: vi.fn().mockReturnValue({ ...dummyLayer, bringToBack: vi.fn() }),
      Control: { extend: vi.fn().mockReturnValue(function () { return dummyLayer; }) },
      DomUtil: { create: vi.fn().mockReturnValue({ setAttribute: vi.fn(), style: {} }) }
    }
  };
});

import {
  MARS_RADIUS_KM,
  lon360ToDisplay,
  displayToLon360,
  clampLat,
  haversineKm,
  getTileMatrixDimensions,
  latLonToTile
} from '../src/core/geo';
import { trekDeepLink } from '../src/core/trekLink';
import { getElevationM } from '../src/core/dem';
import { FALLBACK_TREK_LAYERS } from '../src/map/layers';
import { HAZARDS_CATALOG } from '../src/data/hazardsCatalog';
import { ALL_ROVER_TRAVERSES } from '../src/data/roverTraverses';

describe('Map Smoke & Geodetic Calibration Gate (§10)', () => {
  it('exports MapPage and MarsMapView modules cleanly', async () => {
    const mapPageMod = await import('../src/pages/MapPage');
    expect(typeof mapPageMod.MapPage).toBe('function');

    const mapViewMod = await import('../src/map/MarsMapView');
    expect(typeof mapViewMod.MarsMapView).toBe('function');

    const marsMapMod = await import('../src/map/MarsMap');
    expect(typeof marsMapMod.MarsMap).toBe('function');
  });

  describe('Manual Calibration Table Verifications (§10)', () => {
    it('#1: Gale Crater Region view extent and Trek deep link alignment', () => {
      // Lat -6.5435, LonE 137.1817 (Curiosity region from user brief)
      const lat = -6.54347;
      const lonE = 137.18169;
      const link = trekDeepLink(lat, lonE, 9);

      expect(link).toContain('x=137.18169');
      expect(link).toContain('y=-6.54347');
      expect(link).toContain('z=9');
      expect(link).toContain('p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905');
      expect(link).toContain('b=mars');
      expect(lon360ToDisplay(lonE)).toBeCloseTo(137.18169, 4);
    });

    it('#2: Olympus Mons summit at 18.65°N, 226.2°E (display -133.8°)', () => {
      const lat = 18.65;
      const lonE = 226.2;
      const display = lon360ToDisplay(lonE);
      expect(display).toBeCloseTo(-133.8, 4);
      expect(displayToLon360(display)).toBeCloseTo(lonE, 4);

      // Verify that MOLA DEM places summit caldera at high altitude (> 20,000 m)
      const elev = getElevationM(lat, lonE);
      expect(elev.value).toBeGreaterThan(20000);
      expect(elev.provenance).toBe('NASA-DERIVED');
    });

    it('#3: Jezero Crater at 18.44°N, 77.45°E (display 77.45°)', () => {
      const lat = 18.44;
      const lonE = 77.45;
      const display = lon360ToDisplay(lonE);
      expect(display).toBeCloseTo(77.45, 4);
      expect(displayToLon360(display)).toBeCloseTo(lonE, 4);

      // Jezero crater floor is below Mars datum (< -2000 m)
      const elev = getElevationM(lat, lonE);
      expect(elev.value).toBeLessThan(-2000);
    });

    it('#4: Bradbury Landing at 4.59°S, 137.44°E (display 137.44°)', () => {
      const lat = -4.59;
      const lonE = 137.44;
      const display = lon360ToDisplay(lonE);
      expect(display).toBeCloseTo(137.44, 4);
      expect(displayToLon360(display)).toBeCloseTo(lonE, 4);

      // Gale floor is deep (< -4000 m)
      const elev = getElevationM(lat, lonE);
      expect(elev.value).toBeLessThan(-4000);
    });

    it('#5: World bounds clamping and no horizontal repeat', () => {
      expect(clampLat(95)).toBe(90);
      expect(clampLat(-95)).toBe(-90);
      expect(lon360ToDisplay(360)).toBe(0);
      expect(lon360ToDisplay(180)).toBe(180);
      expect(lon360ToDisplay(180.1)).toBeCloseTo(-179.9, 4);
    });

    it('#6: Tile zoom offset and matrix alignment (Leaflet zoom z -> Trek matrix z - 1)', () => {
      // Leaflet zoom 1 -> Trek matrix 0 (2 cols x 1 row)
      const m0 = getTileMatrixDimensions(0);
      expect(m0.cols).toBe(2);
      expect(m0.rows).toBe(1);

      // At zoom 1, each 256px tile spans 180 degrees
      // Full world width (360 deg) = 2 tiles = 512 px
      const tileWest = latLonToTile(0, -90, 0);
      const tileEast = latLonToTile(0, 90, 0);
      expect(tileWest.col).toBe(0);
      expect(tileEast.col).toBe(1);
    });

    it('#7: Scale bar across 10° of Mars equator ≈ 591.6 - 593 km (not Earth 1113 km)', () => {
      const marsTenDegKm = haversineKm(0, 0, 0, 10, MARS_RADIUS_KM);
      const earthRadiusKm = 6371;
      const earthTenDegKm = haversineKm(0, 0, 0, 10, earthRadiusKm);

      // Mars: (10 / 360) * 2 * pi * 3389.5 ≈ 591.59 km
      expect(marsTenDegKm).toBeCloseTo(591.6, 0);

      // Earth scale is ~1.88x larger (~1112 km)
      expect(earthTenDegKm).toBeCloseTo(1111.9, 0);
      expect(earthTenDegKm / marsTenDegKm).toBeCloseTo(1.88, 1);
    });

    it('#8: Provenance and scientific guardrails verification', () => {
      // RSL are NEVER categorized as a water resource
      for (const hazard of HAZARDS_CATALOG) {
        if (hazard.name.toLowerCase().includes('rsl') || hazard.id.toLowerCase().includes('rsl')) {
          expect(hazard.category).not.toBe('water_resource');
          expect(hazard.category).toBe('steep_terrain');
        }
      }

      // Checkpoints and layers provenance check
      for (const layer of FALLBACK_TREK_LAYERS) {
        expect(layer.attribution).toContain('Mars Trek');
      }

      // Rover data verification: Curiosity and Perseverance exist with verified waypoints
      expect(ALL_ROVER_TRAVERSES.length).toBeGreaterThanOrEqual(2);
      const curiosity = ALL_ROVER_TRAVERSES.find((r) => r.id === 'curiosity-historical');
      expect(curiosity).toBeDefined();
      expect(curiosity?.waypoints.length).toBeGreaterThan(10);
    });
  });
});
