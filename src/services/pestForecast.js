import {
  accumulateDegreeDays,
  PEST_DEGREE_DAY_MODELS,
  clamp,
} from '../utils/mathModels.js';

/**
 * Geo-Farm — Smart Traps Swarm Forecaster
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Simulates laser-camera pheromone trap counts for two pests (Fall Armyworm,
 * Fruit Fly) and combines them with thermal degree-day (GDD) accumulation
 * to forecast swarm/outbreak emergence 7-14 days in advance.
 *
 * No physical traps exist for this demo — this module is the authoritative
 * "hardware" simulation layer, mirroring telemetryService.js's approach.
 */

export const TRAP_LOCATIONS = [
  {
    trapId: 'TRAP-NSK-A1',
    label: 'Nashik Grape Belt — Trap A1',
    lat: 20.0032,
    lng: 73.7955,
    pest: 'ARMYWORM',
  },
  {
    trapId: 'TRAP-NSK-A2',
    label: 'Nashik Grape Belt — Trap A2',
    lat: 19.9998,
    lng: 73.8140,
    pest: 'FRUIT_FLY',
  },
  {
    trapId: 'TRAP-RAH-B1',
    label: 'Rahuri Cotton Belt — Trap B1',
    lat: 19.3921,
    lng: 74.6540,
    pest: 'ARMYWORM',
  },
  {
    trapId: 'TRAP-RAH-B2',
    label: 'Rahuri Cotton Belt — Trap B2',
    lat: 19.4088,
    lng: 74.6655,
    pest: 'FRUIT_FLY',
  },
];

// Economic threshold: trap catch count per night above which the location
// is considered to be entering an active swarm/outbreak window.
const ECONOMIC_THRESHOLD = {
  ARMYWORM: 12, // moths/night
  FRUIT_FLY: 18, // flies/night
};

// ---------------------------------------------------------------------------
// Historical daily temperature synthesis (seeds the GDD model)
// ---------------------------------------------------------------------------

/**
 * Generates a plausible last-N-days Tmax/Tmin series for Maharashtra's
 * grape/cotton belts, with mild random walk so the forecast trend looks
 * organic rather than perfectly periodic.
 */
function synthesizeDailyTemps(days = 21, seed = Math.random() * 100) {
  const readings = [];
  let driftMax = 33 + Math.sin(seed) * 2;
  let driftMin = 19 + Math.cos(seed) * 2;

  for (let i = 0; i < days; i += 1) {
    driftMax += (Math.random() - 0.5) * 1.4;
    driftMin += (Math.random() - 0.5) * 1.0;
    driftMax = clamp(driftMax, 27, 40);
    driftMin = clamp(driftMin, 14, 26);

    readings.push({
      dayIndex: i,
      date: new Date(Date.now() - (days - i) * 86_400_000).toISOString().slice(0, 10),
      tempMax: Number(driftMax.toFixed(1)),
      tempMin: Number(driftMin.toFixed(1)),
    });
  }
  return readings;
}

// ---------------------------------------------------------------------------
// Trap catch simulation
// ---------------------------------------------------------------------------

class PheromoneTrapSimulator {
  constructor(trapMeta) {
    this.meta = trapMeta;
    this.dailyTemps = synthesizeDailyTemps(21, hashSeed(trapMeta.trapId));
    this.catchHistory = []; // trailing nightly counts
    this.baseSeed = hashSeed(trapMeta.trapId + '-catch');
  }

  /**
   * Nightly catch count is correlated with recent GDD accumulation rate:
   * as the pest approaches its emergence threshold, trap activity climbs.
   */
  _simulateNightlyCatch(percentToEmergence) {
    const activityFactor = clamp(percentToEmergence / 100, 0, 1);
    const baseline = 2 + activityFactor * 24; // ramps up to ~26 near emergence
    const noise = (Math.random() - 0.5) * 6;
    return Math.max(0, Math.round(baseline + noise));
  }

  tick() {
    // Advance the synthetic temperature series by one simulated day each
    // several ticks to keep the GDD trend moving during a live demo without
    // jumping wildly on every 4-second interval.
    if (Math.random() < 0.15) {
      const last = this.dailyTemps[this.dailyTemps.length - 1];
      const nextMax = clamp(last.tempMax + (Math.random() - 0.5) * 1.6, 27, 40);
      const nextMin = clamp(last.tempMin + (Math.random() - 0.5) * 1.2, 14, 26);
      this.dailyTemps.push({
        dayIndex: last.dayIndex + 1,
        date: new Date().toISOString().slice(0, 10),
        tempMax: Number(nextMax.toFixed(1)),
        tempMin: Number(nextMin.toFixed(1)),
      });
      if (this.dailyTemps.length > 30) this.dailyTemps.shift();
    }

    const gddResult = accumulateDegreeDays(this.dailyTemps, this.meta.pest);
    const nightlyCatch = this._simulateNightlyCatch(gddResult.percentToEmergence);

    this.catchHistory.push(nightlyCatch);
    if (this.catchHistory.length > 14) this.catchHistory.shift();

    const avgCatch7Night =
      this.catchHistory.slice(-7).reduce((sum, v) => sum + v, 0) /
      Math.max(1, this.catchHistory.slice(-7).length);

    const threshold = ECONOMIC_THRESHOLD[this.meta.pest];
    const swarmImminent = avgCatch7Night >= threshold || gddResult.percentToEmergence >= 90;

    return {
      trapId: this.meta.trapId,
      label: this.meta.label,
      lat: this.meta.lat,
      lng: this.meta.lng,
      pest: this.meta.pest,
      pestLabel: PEST_DEGREE_DAY_MODELS[this.meta.pest].label,
      timestamp: Date.now(),
      nightlyCatch,
      avgCatch7Night: Number(avgCatch7Night.toFixed(1)),
      economicThreshold: threshold,
      swarmImminent,
      degreeDay: {
        cumulativeGdd: gddResult.cumulativeGdd,
        emergenceThreshold: gddResult.emergenceThreshold,
        percentToEmergence: gddResult.percentToEmergence,
        projectedDaysToEmergence: gddResult.projectedDaysToEmergence,
      },
      catchHistory: [...this.catchHistory],
    };
  }
}

function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 1000) / 10;
}

// ---------------------------------------------------------------------------
// Forecast Engine — manages simulators for all traps + pub/sub streaming
// ---------------------------------------------------------------------------

class PestForecastEngine {
  constructor(traps = TRAP_LOCATIONS) {
    this.simulators = new Map(traps.map((t) => [t.trapId, new PheromoneTrapSimulator(t)]));
    this.subscribers = new Map();
    this.intervalId = null;
    this.intervalMs = 5000;
    this.latestReadings = new Map();
  }

  getSnapshot(trapId) {
    const sim = this.simulators.get(trapId);
    if (!sim) return null;
    const reading = sim.tick();
    this.latestReadings.set(trapId, reading);
    return reading;
  }

  getAllSnapshots() {
    return Array.from(this.simulators.keys()).map((id) => this.getSnapshot(id));
  }

  getLatest(trapId) {
    return this.latestReadings.get(trapId) ?? null;
  }

  /** BUGFIX (A1): see telemetryService.js's getLatestOrSnapshot for rationale. */
  getLatestOrSnapshot(trapId) {
    return this.latestReadings.get(trapId) ?? this.getSnapshot(trapId);
  }

  getAllLatestOrSnapshots() {
    return Array.from(this.simulators.keys()).map((id) => this.getLatestOrSnapshot(id));
  }

  listTraps() {
    return Array.from(this.simulators.values()).map((s) => s.meta);
  }

  subscribe(trapId, callback) {
    if (!this.subscribers.has(trapId)) {
      this.subscribers.set(trapId, new Set());
    }
    this.subscribers.get(trapId).add(callback);
    this._ensureRunning();

    return () => {
      const set = this.subscribers.get(trapId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.subscribers.delete(trapId);
      }
      this._maybeStop();
    };
  }

  _ensureRunning() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this._broadcast(), this.intervalMs);
  }

  _maybeStop() {
    if (this.subscribers.size === 0 && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  _broadcast() {
    for (const trapId of this.simulators.keys()) {
      const reading = this.getSnapshot(trapId);

      const specific = this.subscribers.get(trapId);
      if (specific) specific.forEach((cb) => cb(reading));

      const wildcard = this.subscribers.get('*');
      if (wildcard) wildcard.forEach((cb) => cb(reading));
    }
  }
}

// Singleton engine — one shared simulated trap network for the whole app.
export const pestForecastEngine = new PestForecastEngine();

export default pestForecastEngine;
