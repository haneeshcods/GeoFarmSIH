/**
 * Geo-Farm — Spatial ML Risk Interpolation
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Turns sparse, point-sampled classifier output — a handful of geotagged
 * MobileNet leaf-scan results / sensor-node readings, each shaped like
 * `{ lat, lng, diseaseConfidence, severity }` — into a continuous spatial
 * risk *surface* that can be rendered as extruded terrain columns/hexbins.
 *
 * Algorithm: Inverse Distance Weighting (IDW)
 *   For a query point q and known samples s_1..s_n with value v_i:
 *
 *       predicted(q) = Σ(w_i · v_i) / Σ(w_i),   w_i = 1 / distance(q, s_i)^power
 *
 *   - `power` controls how sharply influence falls off with distance
 *     (2 is the geostatistical standard and what's used here by default).
 *   - Distance is computed with the Haversine great-circle formula, not
 *     naive Euclidean distance on raw lat/lng degrees — at this region's
 *     latitude (~19–20°N) a degree of longitude is ~10% shorter than a
 *     degree of latitude, and treating them as equal would visibly skew
 *     the interpolated risk field east–west.
 *   - Only the `maxNeighbors` nearest samples (within `maxRadiusKm`, if
 *     given) contribute to any one query point, which is what keeps this
 *     an O(grid × k) operation instead of O(grid × n) as sample count grows,
 *     and keeps a hotspot on one side of the map from bleeding influence
 *     across the whole region.
 *
 * Kriging note: full ordinary/universal Kriging additionally fits a
 * variogram to the sample set to derive statistically optimal weights and
 * a true prediction-error variance, rather than IDW's fixed inverse-power
 * falloff. That requires enough samples to fit a stable variogram (usually
 * 30+) — with the sparse per-farm sample counts this app actually has,
 * IDW is the more numerically stable choice. `interpolationConfidence()`
 * below is a distance-decay heuristic standing in for kriging's variance
 * estimate; swapping in a real variogram-fitted Kriging model later only
 * requires replacing `idwInterpolate()` — every caller (buildRiskGrid,
 * the deck.gl layers, the hover tooltip) consumes the same output shape.
 */

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** A sample's scalar ML risk value, combining classifier confidence with
 *  predicted severity — a low-confidence high-severity read should not
 *  dominate the field as strongly as a high-confidence one. Clamped to
 *  [0, 1] so it composes safely with color/elevation scales downstream. */
export function sampleRiskValue(sample) {
  const severity = clamp01(sample.severity);
  const confidence = clamp01(sample.diseaseConfidence);
  return clamp01(severity * (0.55 + 0.45 * confidence));
}

function clamp01(n) {
  if (Number.isNaN(n) || n == null) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Distance-decay confidence heuristic for an interpolated point: 1.0 when
 * sitting exactly on a verified sample, decaying toward 0 the further the
 * nearest contributing sample is. `decayKm` is the distance at which
 * confidence drops to 0.5 (a tunable "how far do we trust this model").
 */
export function interpolationConfidence(nearestDistanceKm, decayKm = 4) {
  if (nearestDistanceKm == null) return 0;
  if (nearestDistanceKm <= 0) return 1;
  return clamp01(1 / (1 + nearestDistanceKm / decayKm));
}

/**
 * Core IDW interpolation at a single query coordinate.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{lat:number, lng:number, diseaseConfidence:number, severity:number, id?:string}>} samples
 * @param {{power?:number, maxNeighbors?:number, maxRadiusKm?:number}} [opts]
 * @returns {{ riskScore:number, confidence:number, nearestSample:object|null, nearestDistanceKm:number|null, neighborsUsed:number }}
 */
export function idwInterpolate(lat, lng, samples, opts = {}) {
  const { power = 2, maxNeighbors = 8, maxRadiusKm = Infinity } = opts;

  if (!Array.isArray(samples) || samples.length === 0) {
    return { riskScore: 0, confidence: 0, nearestSample: null, nearestDistanceKm: null, neighborsUsed: 0 };
  }

  const ranked = samples
    .map((s) => ({ sample: s, distanceKm: haversineDistanceKm(lat, lng, s.lat, s.lng) }))
    .filter((r) => r.distanceKm <= maxRadiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (ranked.length === 0) {
    return { riskScore: 0, confidence: 0, nearestSample: null, nearestDistanceKm: null, neighborsUsed: 0 };
  }

  // Exact (or effectively exact) hit on a known sample — return it
  // directly rather than dividing by a near-zero distance.
  if (ranked[0].distanceKm < 1e-6) {
    return {
      riskScore: sampleRiskValue(ranked[0].sample),
      confidence: 1,
      nearestSample: ranked[0].sample,
      nearestDistanceKm: 0,
      neighborsUsed: 1,
    };
  }

  const neighbors = ranked.slice(0, maxNeighbors);

  let weightedSum = 0;
  let weightTotal = 0;
  neighbors.forEach(({ sample, distanceKm }) => {
    const weight = 1 / distanceKm ** power;
    weightedSum += weight * sampleRiskValue(sample);
    weightTotal += weight;
  });

  const riskScore = weightTotal > 0 ? clamp01(weightedSum / weightTotal) : 0;

  return {
    riskScore,
    confidence: interpolationConfidence(ranked[0].distanceKm),
    nearestSample: ranked[0].sample,
    nearestDistanceKm: ranked[0].distanceKm,
    neighborsUsed: neighbors.length,
  };
}

/**
 * Builds a regular lat/lng grid across `bounds` and IDW-interpolates a
 * risk value at every cell center — the "continuous spatial risk
 * gradient" that feeds the deck.gl ColumnLayer/HexagonLayer. Each cell
 * also carries the nearest verified sample + distance, so the map's
 * hover tooltip can cite the real field observation behind any point on
 * the surface.
 *
 * @param {Array} samples
 * @param {{north:number, south:number, east:number, west:number}} bounds
 * @param {{cols?:number, rows?:number, power?:number, maxNeighbors?:number, maxRadiusKm?:number}} [opts]
 */
export function buildRiskGrid(samples, bounds, opts = {}) {
  const { cols = 26, rows = 20, power, maxNeighbors, maxRadiusKm } = opts;
  const { north, south, east, west } = bounds;

  if (!(north > south) || !(east > west)) return [];

  const cellHeight = (north - south) / rows;
  const cellWidth = (east - west) / cols;

  const grid = [];
  for (let r = 0; r < rows; r += 1) {
    const lat = south + cellHeight * (r + 0.5);
    for (let c = 0; c < cols; c += 1) {
      const lng = west + cellWidth * (c + 0.5);
      const result = idwInterpolate(lat, lng, samples, { power, maxNeighbors, maxRadiusKm });
      // Skip near-zero, far-from-everything cells entirely — keeps the
      // rendered surface confined to areas the model actually has signal
      // for, instead of paving the whole bounding box in low columns.
      if (result.riskScore < 0.03 && result.confidence < 0.05) continue;
      grid.push({
        lat,
        lng,
        riskScore: result.riskScore,
        confidence: result.confidence,
        nearestSample: result.nearestSample,
        nearestDistanceKm: result.nearestDistanceKm,
      });
    }
  }
  return grid;
}

/** Nearest verified field sample to an arbitrary map coordinate (used by
 *  the hover tooltip when the cursor is over raw terrain, not a grid cell). */
export function findNearestSample(lat, lng, samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  samples.forEach((s) => {
    const d = haversineDistanceKm(lat, lng, s.lat, s.lng);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  });
  return best ? { sample: best, distanceKm: bestDist } : null;
}

// Shared 5-band risk scale used across the app (GISMap, dashboards, alert
// queue) — re-exported here so the 3D layer's color ramp stays in sync
// with everywhere else risk is drawn.
export const RISK_BANDS = [
  { level: 'LOW', max: 0.2, hex: '#22c55e' }, // emerald
  { level: 'MODERATE', max: 0.4, hex: '#eab308' }, // amber-yellow
  { level: 'HIGH', max: 0.6, hex: '#f97316' }, // amber-orange
  { level: 'SEVERE', max: 0.8, hex: '#dc2626' }, // red
  { level: 'CRITICAL', max: 1.01, hex: '#7f1d1d' }, // deep red
];

export function classifyRiskScore(riskScore) {
  return RISK_BANDS.find((b) => riskScore <= b.max) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

/** Linear RGB interpolation across the emerald -> amber -> red ramp for a
 *  continuous (non-banded) fill color, returned as a deck.gl [r,g,b] array. */
export function riskScoreToRGB(riskScore) {
  const stops = [
    { at: 0, rgb: [16, 185, 129] }, // emerald-500
    { at: 0.5, rgb: [245, 158, 11] }, // amber-500
    { at: 1, rgb: [220, 38, 38] }, // red-600
  ];
  const t = clamp01(riskScore);
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i].at && t <= stops[i + 1].at) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at || 1;
  const localT = (t - lower.at) / span;
  return lower.rgb.map((c, i) => Math.round(c + (upper.rgb[i] - c) * localT));
}

export default {
  haversineDistanceKm,
  sampleRiskValue,
  interpolationConfidence,
  idwInterpolate,
  buildRiskGrid,
  findNearestSample,
  classifyRiskScore,
  riskScoreToRGB,
  RISK_BANDS,
};
