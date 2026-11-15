import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://trek.nasa.gov/tiles/Mars/EQ';
const CANDIDATES = [
  {
    id: 'viking-color',
    title: 'Viking Color Mosaic (global, 232 m)',
    kind: 'satellite',
    names: [
      'Mars_Viking_MDIM21_ClrMosaic_global_232m',
      'Viking_MDIM21_ClrMosaic_global_232m'
    ]
  },
  {
    id: 'mola-shaded-relief',
    title: 'MOLA Shaded Relief (global, 463 m)',
    kind: 'elevation',
    names: [
      'Mars_MGS_MOLA_ClrShade_merge_global_463m',
      'MOLA_ClrShade_merge_global_463m'
    ]
  },
  {
    id: 'mola-elevation',
    title: 'MOLA Color Elevation (global, 463 m)',
    kind: 'elevation',
    names: [
      'Mars_MGS_MOLA_DEM_mosaic_global_463m'
    ]
  }
];

const tileXY = (lat: number, lon: number, m: number) => {
  const deg = 180 / 2 ** m;
  return { col: Math.floor((lon + 180) / deg), row: Math.floor((90 - lat) / deg) };
};

const isImage = async (url: string) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
};

async function resolve(name: string, ext: string) {
  const tpl = (m: number, r: number, c: number) =>
    `${BASE}/${name}/1.0.0/default/default028mm/${m}/${r}/${c}.${ext}`;
  if (!(await isImage(tpl(0, 0, 0)))) return null;
  // Gale-region point from the Trek link (lat −6.5435, lon 137.1817) — present in any global product.
  let max = 0;
  for (let m = 1; m <= 14; m++) {
    const { row, col } = tileXY(-6.5435, 137.1817, m);
    if (await isImage(tpl(m, row, col))) max = m;
    else break;
  }
  return { max, template: `${BASE}/${name}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}` };
}

async function main() {
  const out: any[] = [];
  for (const c of CANDIDATES) {
    let resolved = false;
    for (const name of c.names) {
      if (resolved) break;
      for (const ext of ['jpg', 'png']) {
        console.log(`Probing ${name}.${ext}...`);
        const r = await resolve(name, ext);
        if (r) {
          out.push({
            id: c.id,
            title: c.title,
            kind: c.kind,
            urlTemplate: r.template,
            tileSize: 256,
            minZoom: 1,
            maxNativeZoom: r.max + 1,
            maxMatrix: r.max,
            ext,
            bbox: [-180, -90, 180, 90],
            projection: 'equirectangular',
            attribution: 'NASA/JPL/USGS · Mars Trek',
            provenance: 'NASA-DERIVED',
            verifiedOn: new Date().toISOString().slice(0, 10),
            active: c.id === 'viking-color',
            opacity: 1.0
          });
          console.log(`OK   ${name}.${ext} maxMatrix: ${r.max}`);
          resolved = true;
          break;
        } else {
          console.log(`MISS ${name}.${ext}`);
        }
      }
    }
  }

  if (!out.length) {
    console.error('No Trek layer resolved. Check network / layer names.');
    process.exit(1);
  }

  mkdirSync('public/data', { recursive: true });
  writeFileSync(
    'public/data/layers.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), layers: out }, null, 2)
  );
  console.log(`Wrote ${out.length} layers to public/data/layers.json`);
}

main().catch((err) => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
