/**
 * MARS LANTERN — Mars Trek Deep-Link Generator
 * 
 * Constructs deep links into NASA's Mars Trek portal matching viewport bounds and coordinates.
 * Reference: docs/MAP_FIX_SPEC.md §1
 */

export function trekDeepLink(
  lat: number,
  lonE: number,
  z = 9,
  halfWidthDeg = 0.88,
  halfHeightDeg = 0.44
): string {
  const w = lonE - halfWidthDeg;
  const e = lonE + halfWidthDeg;
  const s = lat - halfHeightDeg;
  const n = lat + halfHeightDeg;
  const ext = [w, s, e, n].map((v) => v.toFixed(5)).join('%2C');
  return (
    `https://trek.nasa.gov/mars/#v=0.1&x=${lonE.toFixed(5)}&y=${lat.toFixed(5)}&z=${z}` +
    `&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=&locale=&b=mars&e=${ext}&sfz=&w=`
  );
}
