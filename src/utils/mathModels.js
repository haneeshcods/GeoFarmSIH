/**
 * Geo-Farm — Shared Mathematical Models
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * This module contains the core numeric models reused by:
 *   - services/telemetryService.js  (fungal infection risk from T + LWD)
 *   - services/pestForecast.js      (pest emergence from degree-day accumulation)
 *
 * References (agronomic literature, implemented as simplified lookup +
 * interpolation models suitable for a real-time demo):
 *   - Magarey, R.D. et al. "A simple generic infection model for foliar
 *     fungal plant pathogens" — temperature x leaf-wetness-duration (LWD)
 *     minimum-hours-to-infection curves.
 *   - Mills, D.J. — grape downy/powdery mildew wetness-duration criteria.
 *   - Standard single-sine growing degree-day (GDD) accumulation used in
 *     IPM (Integrated Pest Management) pest-emergence forecasting.
 */

// ---------------------------------------------------------------------------
// Generic numeric helpers
// ---------------------------------------------------------------------------

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation between two points (x0,y0) -> (x1,y1) at x. */
export function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}

/**
 * Piecewise-linear interpolation across a sorted array of [x, y] points.
 * Clamps to the first/last y value outside the table's domain.
 */
export function interpolateTable(x, table) {
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i += 1) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      return lerp(x, x0, y0, x1, y1);
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------------------
// Magarey-style Pathogen Infection Model
// ---------------------------------------------------------------------------
// For a given mean canopy temperature during the wetness period, each
// pathogen table gives the MINIMUM leaf-wetness-duration (hours) needed for
// a light (initial) infection event. Below that duration -> negligible risk.
// Risk then scales from 0 (at the minimum threshold) toward 1.0 as observed
// LWD extends toward roughly 2x-2.5x the minimum requirement, which is a
// standard simplification of Magarey/Mills severity scaling used in
// decision-support tools such as grape disease risk models.

export const PATHOGEN_TABLES = {
  DOWNY_MILDEW: {
    label: 'Downy Mildew (Plasmopara viticola)',
    // [temperature °C, minimum wetness hours for infection]
    minWetnessHours: [
      [10, 18],
      [13, 12],
      [16, 8],
      [20, 6],
      [22, 5],
      [25, 5.5],
      [28, 7],
      [30, 10],
      [33, 20],
    ],
    optimalTempRange: [20, 25],
  },
  POWDERY_MILDEW: {
    label: 'Powdery Mildew (Erysiphe necator)',
    // Powdery mildew does not strictly require free water, but conidial
    // germination risk still rises sharply with humid/wetness duration in
    // the 20-27°C band; table reflects relative-humidity-driven risk hours.
    minWetnessHours: [
      [10, 30],
      [15, 18],
      [20, 8],
      [23, 5],
      [25, 5],
      [28, 7],
      [32, 14],
      [35, 26],
    ],
    optimalTempRange: [22, 28],
  },
};

/**
 * Computes fungal infection risk (0-1) for a pathogen given the mean
 * temperature (°C) during the wetness event and the observed leaf wetness
 * duration (hours).
 *
 * @param {number} meanTempC
 * @param {number} lwdHours
 * @param {'DOWNY_MILDEW'|'POWDERY_MILDEW'} pathogenKey
 * @returns {{ riskScore: number, riskLevel: string, minWetnessRequired: number, pathogen: string }}
 */
export function calculateMagareyInfectionRisk(meanTempC, lwdHours, pathogenKey = 'DOWNY_MILDEW') {
  const pathogen = PATHOGEN_TABLES[pathogenKey] ?? PATHOGEN_TABLES.DOWNY_MILDEW;
  const minRequired = interpolateTable(meanTempC, pathogen.minWetnessHours);

  if (lwdHours <= 0 || minRequired <= 0) {
    return {
      riskScore: 0,
      riskLevel: 'LOW',
      minWetnessRequired: Number(minRequired.toFixed(1)),
      pathogen: pathogen.label,
    };
  }

  // Risk ramps 0 -> 1 as lwdHours goes from minRequired to 2.5x minRequired.
  const severityCeiling = minRequired * 2.5;
  let riskScore = clamp((lwdHours - minRequired) / (severityCeiling - minRequired), 0, 1);

  // Below the minimum threshold, still allow a small "approaching risk"
  // signal (0 - 0.15) so the dashboard shows building risk rather than a
  // hard cliff from 0 -> nonzero.
  if (lwdHours < minRequired) {
    riskScore = clamp((lwdHours / minRequired) * 0.15, 0, 0.15);
  }

  return {
    riskScore: Number(riskScore.toFixed(3)),
    riskLevel: classifyRiskScore(riskScore),
    minWetnessRequired: Number(minRequired.toFixed(1)),
    pathogen: pathogen.label,
  };
}

/** Maps a 0-1 numeric risk score to the 5-tier severity scale used app-wide. */
export function classifyRiskScore(score) {
  if (score >= 0.85) return 'CRITICAL';
  if (score >= 0.65) return 'SEVERE';
  if (score >= 0.4) return 'HIGH';
  if (score >= 0.15) return 'MODERATE';
  return 'LOW';
}

export const RISK_COLOR_MAP = {
  LOW: '#22c55e',
  MODERATE: '#eab308',
  HIGH: '#f97316',
  SEVERE: '#dc2626',
  CRITICAL: '#7f1d1d',
};

// ---------------------------------------------------------------------------
// Growing / Thermal Degree-Day (GDD) Accumulation for Pest Emergence
// ---------------------------------------------------------------------------
// Standard single-sine-approximation-free "averaging method":
//   GDD(day) = max(0, ((Tmax + Tmin) / 2) - Tbase), capped by Tupper if given.
// Accumulated across days until a pest-specific emergence threshold is hit.

export const PEST_DEGREE_DAY_MODELS = {
  ARMYWORM: {
    label: 'Fall Armyworm (Spodoptera frugiperda)',
    baseTempC: 11.5,
    upperTempC: 35,
    emergenceThreshold: 380, // accumulated GDD to next generation/outbreak
  },
  FRUIT_FLY: {
    label: 'Fruit Fly (Bactrocera dorsalis)',
    baseTempC: 13,
    upperTempC: 33,
    emergenceThreshold: 300,
  },
};

/**
 * Daily GDD contribution using the averaging method with an upper
 * development threshold cutoff (horizontal cutoff method).
 */
export function calculateDailyDegreeDay(tempMaxC, tempMinC, baseTempC, upperTempC = Infinity) {
  const cappedMax = Math.min(tempMaxC, upperTempC);
  const cappedMin = Math.min(tempMinC, upperTempC);
  const mean = (cappedMax + cappedMin) / 2;
  return Math.max(0, mean - baseTempC);
}

/**
 * Accumulates GDD across a series of { tempMax, tempMin } daily readings
 * and returns running total plus a projected days-to-emergence estimate
 * based on the recent average daily accumulation rate.
 *
 * @param {Array<{tempMax:number, tempMin:number}>} dailyReadings
 * @param {'ARMYWORM'|'FRUIT_FLY'} pestKey
 */
export function accumulateDegreeDays(dailyReadings, pestKey = 'ARMYWORM') {
  const model = PEST_DEGREE_DAY_MODELS[pestKey] ?? PEST_DEGREE_DAY_MODELS.ARMYWORM;

  let cumulative = 0;
  const series = dailyReadings.map((reading) => {
    const dailyGdd = calculateDailyDegreeDay(
      reading.tempMax,
      reading.tempMin,
      model.baseTempC,
      model.upperTempC
    );
    cumulative += dailyGdd;
    return { ...reading, dailyGdd: Number(dailyGdd.toFixed(2)), cumulativeGdd: Number(cumulative.toFixed(2)) };
  });

  const recentWindow = series.slice(-7);
  const avgDailyRate =
    recentWindow.length > 0
      ? recentWindow.reduce((sum, d) => sum + d.dailyGdd, 0) / recentWindow.length
      : 0;

  const remainingGdd = Math.max(0, model.emergenceThreshold - cumulative);
  const projectedDaysToEmergence =
    avgDailyRate > 0 ? Math.ceil(remainingGdd / avgDailyRate) : null;

  return {
    pest: model.label,
    cumulativeGdd: Number(cumulative.toFixed(2)),
    emergenceThreshold: model.emergenceThreshold,
    percentToEmergence: Number(clamp((cumulative / model.emergenceThreshold) * 100, 0, 100).toFixed(1)),
    projectedDaysToEmergence,
    series,
  };
}

// ---------------------------------------------------------------------------
// Weighted moving average — used to smooth simulated sensor noise before
// feeding readings into the risk models above.
// ---------------------------------------------------------------------------

export function weightedMovingAverage(values, weights) {
  if (values.length === 0) return 0;
  const w = weights ?? values.map((_, i) => i + 1); // linearly increasing recency weight
  const totalWeight = w.reduce((sum, x) => sum + x, 0);
  const weightedSum = values.reduce((sum, v, i) => sum + v * w[i], 0);
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ---------------------------------------------------------------------------
// Shared emergence-risk banding for pest degree-day forecasts.
// Single source of truth — consumed by both PestForecastPanel.jsx (what the
// officer sees) and useAutoAlertMonitor.js (what triggers the alert), so the
// two can never silently drift apart.
// ---------------------------------------------------------------------------

export function classifyEmergenceRisk(percentToEmergence) {
  if (percentToEmergence >= 90) return 'CRITICAL';
  if (percentToEmergence >= 70) return 'SEVERE';
  if (percentToEmergence >= 45) return 'HIGH';
  if (percentToEmergence >= 20) return 'MODERATE';
  return 'LOW';
}
