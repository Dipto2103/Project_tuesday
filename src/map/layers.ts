/**
 * MARS LANTERN — Layer Loader & Registry Access
 * 
 * Loads public/data/layers.json with embedded fallback defaults.
 * Reference: docs/MAP_FIX_SPEC.md §4.1, §5.4
 */

import type { TrekLayerDef } from './MarsMap';

export const FALLBACK_TREK_LAYERS: TrekLayerDef[] = [
  {
    id: 'viking-color',
    title: 'Viking Color Mosaic (global, 232 m)',
    kind: 'satellite',
    urlTemplate:
      'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxMatrix: 7,
    ext: 'jpg',
    attribution: 'NASA/JPL/USGS · Mars Trek'
  },
  {
    id: 'mola-shaded-relief',
    title: 'MOLA Shaded Relief (global, 463 m)',
    kind: 'elevation',
    urlTemplate:
      'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxMatrix: 7,
    ext: 'jpg',
    attribution: 'NASA/JPL/USGS · Mars Trek'
  },
  {
    id: 'gale-crater-offline',
    title: 'Gale Crater Detailed (Offline Cache)',
    kind: 'satellite',
    urlTemplate: '/tiles/offline/viking/{z}/{y}/{x}.jpg',
    maxMatrix: 7,
    ext: 'jpg',
    attribution: 'NASA/JPL/USGS · Mars Trek (Local Cache)'
  }
];

export async function loadTrekLayers(): Promise<TrekLayerDef[]> {
  try {
    const url = `${import.meta.env.BASE_URL}data/layers.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawList: any[] = Array.isArray(data) ? data : data.layers ?? [];
    if (!rawList.length) return FALLBACK_TREK_LAYERS;

    return rawList.map((l) => ({
      id: l.id,
      title: l.title,
      kind: l.kind,
      urlTemplate: l.urlTemplate,
      maxMatrix: typeof l.maxMatrix === 'number' ? l.maxMatrix : 7,
      ext: l.ext || 'jpg',
      attribution: l.attribution || 'NASA / Mars Trek'
    }));
  } catch (err) {
    console.warn('[LAYERS] Failed to load layers.json, using fallback:', err);
    return FALLBACK_TREK_LAYERS;
  }
}
