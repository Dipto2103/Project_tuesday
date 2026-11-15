/**
 * MARS LANTERN — Mars Map View (React Shell)
 * 
 * StrictMode-safe React shell wrapping the imperative MarsMap Leaflet engine.
 * Created once on mount, destroyed in effect cleanup.
 * Callbacks are kept stable in refs to avoid re-triggering effects.
 * Reference: docs/MAP_FIX_SPEC.md §4.6
 */

import React, { useEffect, useRef } from 'react';
import {
  MarsMap,
  type MarkerDef,
  type TrekLayerDef,
  type Viewport
} from './MarsMap';

export interface MarsMapViewProps {
  layers: TrekLayerDef[];
  baseLayerId: string;
  markers: MarkerDef[];
  initial: { lat: number; lonE: number; zoom: number };
  onMapClick?: (p: { lat: number; lonE: number }) => void;
  onViewport?: (v: Viewport) => void;
  onCursorMove?: (p: { lat: number; lonE: number; displayLon: number }) => void;
  onBackendDegraded?: (degraded: boolean) => void;
  routeSegments?: { points: [number, number][]; flag: 'ok' | 'steep' | 'nodata' }[];
  showGraticule?: boolean;
  mapInstanceRef?: React.MutableRefObject<MarsMap | null>;
}

export const MarsMapView: React.FC<MarsMapViewProps> = ({
  layers,
  baseLayerId,
  markers,
  initial,
  onMapClick,
  onViewport,
  onCursorMove,
  onBackendDegraded,
  routeSegments,
  showGraticule = true,
  mapInstanceRef
}) => {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MarsMap | null>(null);

  // Stable callback refs prevent effect re-runs
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  const vpRef = useRef(onViewport);
  vpRef.current = onViewport;

  const cursorRef = useRef(onCursorMove);
  cursorRef.current = onCursorMove;

  const degradedRef = useRef(onBackendDegraded);
  degradedRef.current = onBackendDegraded;

  useEffect(() => {
    if (!host.current) return;

    const fallbackUrl = `${import.meta.env.BASE_URL}tiles/fallback-global.jpg`;

    const m = new MarsMap({
      container: host.current,
      layers,
      baseLayerId,
      initial,
      fallbackImageUrl: fallbackUrl,
      onMapClick: (p) => clickRef.current?.(p),
      onViewport: (v) => vpRef.current?.(v),
      onCursorMove: (c) => cursorRef.current?.(c),
      onBackendDegraded: (d) => degradedRef.current?.(d),
      showGraticule
    });

    map.current = m;
    if (mapInstanceRef) {
      mapInstanceRef.current = m;
    }

    return () => {
      m.destroy();
      map.current = null;
      if (mapInstanceRef) {
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setBaseLayer(baseLayerId);
  }, [baseLayerId]);

  useEffect(() => {
    map.current?.setMarkers(markers);
  }, [markers]);

  useEffect(() => {
    if (routeSegments) {
      map.current?.setRoute(routeSegments);
    }
  }, [routeSegments]);

  useEffect(() => {
    map.current?.setGraticuleVisible(showGraticule);
  }, [showGraticule]);

  return (
    <div
      ref={host}
      className="absolute inset-0 bg-[#0B0D10] select-none"
      role="application"
      aria-label="Mars map"
    />
  );
};
