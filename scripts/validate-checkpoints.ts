/**
 * MARS LANTERN — Checkpoint Geodetic Validation & Stacking Detection
 * 
 * Verifies every record in public/data/checkpoints.json:
 * - -90 <= lat <= 90
 * - 0 <= lonE < 360
 * - unique id
 * - coordSource present
 * - warns on records closer than 0.05° (stacked icons)
 * - warns on records with coordSource: 'memory-verify'
 * 
 * Reference: docs/MAP_FIX_2.md §5.3
 */

import { readFileSync } from 'node:fs';
import { haversineKm } from '../src/core/geo';

interface CheckpointRecord {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lonE: number;
  coordSource?: string;
  coordConfidence?: string;
}

export function validateCheckpoints(filePath = 'public/data/checkpoints.json') {
  const content = readFileSync(filePath, 'utf-8');
  const checkpoints: CheckpointRecord[] = JSON.parse(content);

  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];

    // Unique ID
    if (!cp.id) {
      errors.push(`Record #${i} is missing an 'id'.`);
    } else if (seenIds.has(cp.id)) {
      errors.push(`Duplicate checkpoint id: '${cp.id}'.`);
    } else {
      seenIds.add(cp.id);
    }

    // Latitude [-90, 90]
    if (typeof cp.lat !== 'number' || Number.isNaN(cp.lat) || cp.lat < -90 || cp.lat > 90) {
      errors.push(`Record '${cp.id}' has invalid latitude: ${cp.lat} (must be -90 <= lat <= 90).`);
    }

    // Longitude [0, 360)
    if (typeof cp.lonE !== 'number' || Number.isNaN(cp.lonE) || cp.lonE < 0 || cp.lonE >= 360) {
      errors.push(`Record '${cp.id}' has invalid East longitude: ${cp.lonE} (must be 0 <= lonE < 360).`);
    }

    // coordSource present
    if (!cp.coordSource) {
      errors.push(`Record '${cp.id}' is missing 'coordSource'.`);
    } else if (cp.coordSource === 'memory-verify') {
      warnings.push(`Record '${cp.id}' has unverified coordSource 'memory-verify' (needs ground truth confirmation).`);
    }

    // Proximity / Stacked Icon check (closer than 0.05 degrees)
    for (let j = i + 1; j < checkpoints.length; j++) {
      const other = checkpoints[j];
      const dLat = Math.abs(cp.lat - other.lat);
      let dLon = Math.abs(cp.lonE - other.lonE);
      if (dLon > 180) dLon = 360 - dLon;
      const degDist = Math.sqrt(dLat * dLat + dLon * dLon);

      if (degDist < 0.05) {
        const km = haversineKm(cp.lat, cp.lonE, other.lat, other.lonE);
        warnings.push(
          `Stacked/overlapping markers (< 0.05°): '${cp.id}' (${cp.lat.toFixed(2)}, ${cp.lonE.toFixed(2)}) and '${other.id}' (${other.lat.toFixed(2)}, ${other.lonE.toFixed(2)}) — separation ${km.toFixed(2)} km (${degDist.toFixed(4)}°).`
        );
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`MARS LANTERN — CHECKPOINT GEODETIC VALIDATION REPORT`);
  console.log(`======================================================`);
  console.log(`Total checkpoints inspected: ${checkpoints.length}`);
  console.log(`Unique IDs verified:         ${seenIds.size}`);
  console.log(`Hard validation errors:      ${errors.length}`);
  console.log(`Warnings (stacked/unverified):${warnings.length}`);
  console.log(`------------------------------------------------------`);

  if (warnings.length > 0) {
    console.log(`\nWARNINGS (${warnings.length}):`);
    warnings.forEach((w) => console.warn(`  [WARN] ${w}`));
  }

  if (errors.length > 0) {
    console.error(`\nERRORS (${errors.length}):`);
    errors.forEach((e) => console.error(`  [FAIL] ${e}`));
    console.error(`\nValidation FAILED with ${errors.length} hard error(s).`);
    return false;
  }

  console.log(`\n[PASS] All ${checkpoints.length} checkpoints strictly comply with planetary geodetic standards.\n`);
  return true;
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('validate-checkpoints.ts') || 
  process.argv[1].endsWith('validate-checkpoints.js')
);

if (isDirectRun) {
  const ok = validateCheckpoints();
  if (!ok) process.exit(1);
}
