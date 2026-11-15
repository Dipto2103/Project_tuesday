/**
 * MARS LANTERN — Mars-Radius Planetary Scale Control
 * 
 * Replaces standard Leaflet scale control (which assumes Earth radius 6371 km).
 * Computes exact ground scale using Mars volumetric mean radius (3389.5 km) via haversineKm.
 * Reference: docs/MAP_FIX_SPEC.md §4.5
 */

import L from 'leaflet';
import { haversineKm } from '../core/geo';

export const MarsScale = L.Control.extend({
  options: {
    position: 'bottomleft'
  },

  onAdd(map: L.Map) {
    const el = L.DomUtil.create('div', 'ml-scale');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Mars map scale');

    const update = () => {
      const size = map.getSize();
      if (!size.x || !size.y) return;

      const y = size.y / 2;
      const a = map.containerPointToLatLng([10, y]);
      const b = map.containerPointToLatLng([110, y]);
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);

      if (!km || km <= 0 || !Number.isFinite(km)) return;

      const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].reduce(
        (p, c) => (c <= km ? c : p),
        0.1
      );

      const widthPx = Math.max(20, Math.min(250, Math.round((100 * nice) / km)));
      el.style.width = `${widthPx}px`;
      el.textContent = `${nice} km`;
    };

    map.on('zoomend moveend', update);
    setTimeout(update, 50);

    return el;
  }
});
