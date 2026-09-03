import {
  calculateMagareyInfectionRisk,
  weightedMovingAverage,
  classifyRiskScore,
} from '../utils/mathModels.js';

/**
 * Geo-Farm — Shared-Node IoT Telemetry Engine
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Simulates a network of shared physical sensor nodes, each covering a
 * ~1.5 km radius cluster of farms (the "shared-node" cost-sharing model
 * pitched in the deck for smallholder adoption). Each node streams:
 *   - temperature (°C)
 *   - relative humidity (%)
 *   - leaf wetness duration, LWD (accumulated hours of continuous wetness)
 *
 * and derives real-time fungal infection risk via the Magarey model
 * (see utils/mathModels.js) for Downy Mildew and Powdery Mildew.
 *
 * No physical hardware exists for this demo — this module is the
 * authoritative "hardware" simulation layer consumed by the UI.
 */

// ---------------------------------------------------------------------------
// Default shared-node clusters (Nashik / Rahuri grape & cotton belts,
// Maharashtra). geoDataService.js may extend/override this list with
// richer farm-boundary data; ids here are the join key.
// ---------------------------------------------------------------------------

export const DEFAULT_CLUSTER_NODES = [
  {
    nodeId: 'NODE-NSK-01',
    label: 'Nashik Grape Belt — Node 1',
    lat: 20.0059,
    lng: 73.7910,
    radiusKm: 1.5,
    crop: 'Grape',
    farmsServed: 6,
  },
  {
    nodeId: 'NODE-NSK-02',
    label: 'Nashik Grape Belt — Node 2',
    lat: 19.9975,
    lng: 73.8210,
    radiusKm: 1.5,
    crop: 'Grape',
    farmsServed: 4,
  },
  {
    nodeId: 'NODE-RAH-01',
    label: 'Rahuri Cotton Belt — Node 1',
    lat: 19.3897,
    lng: 74.6494,
    radiusKm: 1.5,
    crop: 'Cotton',
    farmsServed: 8,
  },
  {
    nodeId: 'NODE-RAH-02',
    label: 'Rahuri Cotton Belt — Node 2',
    lat: 19.4115,
    lng: 74.6702,
    radiusKm: 1.5,
    crop: 'Cotton',
    farmsServed: 5,
  },
];

// ---------------------------------------------------------------------------
// Per-node simulated sensor state
// ---------------------------------------------------------------------------

class SensorNodeSimulator {
  constructor(nodeMeta) {
    this.meta = nodeMeta;
    this.lwdHours = 0; // current continuous leaf-wetness accumulation
    this.tempHistory = []; // rolling recent temps for smoothing
    this.lastTimestamp = Date.now();
    this.baseSeed = Math.random() * 1000; // per-node phase offset for variety
  }

  /** Diurnal temperature curve (sine wave) + node-specific offset + noise. */
  _simulateTemperature(hourOfDay) {
    const meanTemp = 24; // seasonal mean for Maharashtra grape/cotton belts
    const amplitude = 8; // day/night swing
    // Peak around 15:00, trough around 04:00
    const phase = ((hourOfDay - 15) / 24) * 2 * Math.PI;
    const diurnal = meanTemp + amplitude * Math.cos(phase);
    const nodeOffset = Math.sin(this.baseSeed) * 1.2;
    const noise = (Math.random() - 0.5) * 1.5;
    return Number((diurnal + nodeOffset + noise).toFixed(2));
  }

  /** Humidity inversely tracks temperature, spikes overnight/early morning. */
  _simulateHumidity(hourOfDay, tempC) {
    const isNightOrDawn = hourOfDay >= 20 || hourOfDay <= 7;
    const base = isNightOrDawn ? 82 : 55;
    const tempPenalty = clampHumidity((tempC - 24) * -1.2);
    const noise = (Math.random() - 0.5) * 6;
    return Math.round(clampHumidity(base + tempPenalty + noise));
  }

  /**
   * Leaf wetness accumulates when humidity is high (>= 90%) or during
   * simulated dew/rain events, and resets/decays once conditions dry out —
   * mirroring real canopy-wetness sensor behavior.
   */
  _updateLeafWetness(humidity, deltaHours) {
    const isWetCondition = humidity >= 88;
    if (isWetCondition) {
      this.lwdHours += deltaHours;
    } else if (humidity < 70) {
      // Dries out relatively quickly once humidity drops
      this.lwdHours = Math.max(0, this.lwdHours - deltaHours * 2);
    }
    // Cap so a single stuck reading can't run away indefinitely
    this.lwdHours = Math.min(this.lwdHours, 48);
    return Number(this.lwdHours.toFixed(2));
  }

  /** Produces one full sensor + derived-risk reading for this node. */
  tick() {
    const now = Date.now();
    const deltaHours = clampHumidity((now - this.lastTimestamp) / 3_600_000, 0.0005, 6); // safety clamp
    this.lastTimestamp = now;

    const date = new Date(now);
    const hourOfDay = date.getHours() + date.getMinutes() / 60;

    const temperature = this._simulateTemperature(hourOfDay);
    const humidity = this._simulateHumidity(hourOfDay, temperature);
    const lwdHours = this._updateLeafWetness(humidity, deltaHours);

    this.tempHistory.push(temperature);
    if (this.tempHistory.length > 12) this.tempHistory.shift();
    const smoothedTemp = Number(weightedMovingAverage(this.tempHistory).toFixed(2));

    const downyMildew = calculateMagareyInfectionRisk(smoothedTemp, lwdHours, 'DOWNY_MILDEW');
    const powderyMildew = calculateMagareyInfectionRisk(smoothedTemp, lwdHours, 'POWDERY_MILDEW');

    const dominant =
      downyMildew.riskScore >= powderyMildew.riskScore ? downyMildew : powderyMildew;

    return {
      nodeId: this.meta.nodeId,
      label: this.meta.label,
      lat: this.meta.lat,
      lng: this.meta.lng,
      radiusKm: this.meta.radiusKm,
      crop: this.meta.crop,
      farmsServed: this.meta.farmsServed,
      timestamp: now,
      temperature,
      smoothedTemp,
      humidity,
      lwdHours,
      risk: {
        downyMildew,
        powderyMildew,
        dominantPathogen: dominant.pathogen,
        dominantRiskScore: dominant.riskScore,
        dominantRiskLevel: dominant.riskLevel,
      },
    };
  }
}

function clampHumidity(v, min = 0, max = 100) {
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// Telemetry Engine — manages simulators for all nodes + pub/sub streaming
// ---------------------------------------------------------------------------

class TelemetryEngine {
  constructor(nodes = DEFAULT_CLUSTER_NODES) {
    this.simulators = new Map(nodes.map((n) => [n.nodeId, new SensorNodeSimulator(n)]));
    this.subscribers = new Map(); // nodeId -> Set<callback>  ('*' = all nodes)
    this.intervalId = null;
    this.intervalMs = 4000;
    this.latestReadings = new Map();
  }

  /** One-off synchronous reading for a single node (no subscription needed). */
  getSnapshot(nodeId) {
    const sim = this.simulators.get(nodeId);
    if (!sim) return null;
    const reading = sim.tick();
    this.latestReadings.set(nodeId, reading);
    return reading;
  }

  /** Snapshot across every node in the network — used for map overlays. */
  getAllSnapshots() {
    return Array.from(this.simulators.keys()).map((id) => this.getSnapshot(id));
  }

  getLatest(nodeId) {
    return this.latestReadings.get(nodeId) ?? null;
  }

  /**
   * BUGFIX (A1): Returns the cached latest reading if one already exists,
   * only forcing a fresh tick() if this node has genuinely never been read
   * before. Prevents every newly-mounted consumer of the wildcard stream
   * (Dashboard overview, GISMap, useAutoAlertMonitor) from each advancing
   * the simulation clock independently on mount.
   */
  getLatestOrSnapshot(nodeId) {
    return this.latestReadings.get(nodeId) ?? this.getSnapshot(nodeId);
  }

  /** Cache-aware equivalent of getAllSnapshots() — see getLatestOrSnapshot(). */
  getAllLatestOrSnapshots() {
    return Array.from(this.simulators.keys()).map((id) => this.getLatestOrSnapshot(id));
  }

  listNodes() {
    return Array.from(this.simulators.values()).map((s) => s.meta);
  }

  /**
   * Subscribe to live updates for a specific nodeId, or pass '*' to receive
   * every node's reading on every tick. Returns an unsubscribe function.
   */
  subscribe(nodeId, callback) {
    if (!this.subscribers.has(nodeId)) {
      this.subscribers.set(nodeId, new Set());
    }
    this.subscribers.get(nodeId).add(callback);
    this._ensureRunning();

    return () => {
      const set = this.subscribers.get(nodeId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.subscribers.delete(nodeId);
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
    for (const nodeId of this.simulators.keys()) {
      const reading = this.getSnapshot(nodeId);

      const specific = this.subscribers.get(nodeId);
      if (specific) specific.forEach((cb) => cb(reading));

      const wildcard = this.subscribers.get('*');
      if (wildcard) wildcard.forEach((cb) => cb(reading));
    }
  }
}

// Singleton engine — one shared simulated sensor network for the whole app.
export const telemetryEngine = new TelemetryEngine();

/** Convenience helper: classify a raw risk score using the shared scale. */
export function classifyTelemetryRisk(score) {
  return classifyRiskScore(score);
}

export default telemetryEngine;
