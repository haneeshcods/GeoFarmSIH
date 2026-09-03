import React, { useEffect, useMemo, useState, useRef } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { Map as MapIcon, Layers, Radio, Bug, Satellite } from 'lucide-react';
import { Card, CardHeader } from './ui/Card.jsx';
import { RiskBadge, Badge } from './ui/Badge.jsx';
import { Toggle } from './ui/Toggle.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useTelemetryStream } from '../hooks/useTelemetryStream.js';
import { usePestForecast } from '../hooks/usePestForecast.js';

/**
 * Geo-Farm — Interactive GIS Satellite Canopy Map
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Leaflet map centered on the Nashik / Rahuri (Maharashtra) grape & cotton
 * belts, rendering:
 *   - shared-node sensor markers with 1.5 km coverage radius circles
 *   - pheromone trap markers with swarm-imminent highlighting
 *   - a simulated NDVI canopy-stress heatmap layer (via leaflet.heat),
 *     weighted by each node's live Magarey infection risk score
 */

const MAP_CENTER = [19.7, 74.2]; // midpoint between Nashik and Rahuri belts
const MAP_ZOOM = 9;

const RISK_HEX = {
  LOW: '#22c55e',
  MODERATE: '#eab308',
  HIGH: '#f97316',
  SEVERE: '#dc2626',
  CRITICAL: '#7f1d1d',
};

/** Deterministic per-node jitter seed so heatmap points hold a stable
 *  position across ticks — only their weight (risk score) should change,
 *  not their location. Derived from a simple string hash of the nodeId. */
function seededJitter(seedStr, index) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i += 1) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  // Two independent pseudo-random streams derived from the same seed +
  // point index, deterministic across renders for the same node/point.
  const a = Math.sin(hash * 12.9898 + index * 78.233) * 43758.5453;
  const b = Math.sin(hash * 39.3468 + index * 11.135) * 24634.6345;
  const rand1 = a - Math.floor(a);
  const rand2 = b - Math.floor(b);
  return { latJitter: (rand1 - 0.5) * 0.02, lngJitter: (rand2 - 0.5) * 0.02 };
}

/** Generates jittered stress points around a node, weighted by risk score — simulates a multi-spectral NDVI raster without needing real satellite tiles. */
function buildHeatPoints(nodeReadings) {
  const points = [];
  nodeReadings.forEach((reading) => {
    if (!reading) return;
    const weight = Math.max(0.15, reading.risk.dominantRiskScore);
    const pointCount = 10;
    for (let i = 0; i < pointCount; i += 1) {
      const { latJitter, lngJitter } = seededJitter(reading.nodeId, i);
      points.push([reading.lat + latJitter, reading.lng + lngJitter, weight]);
    }
  });
  return points;
}

function NdviHeatLayer({ points, visible }) {
  const map = useMap();
  const layerRef = useRef(null);
  const pointsRef = useRef(points);

  // BUGFIX (C2): keep pointsRef synced with the latest points on every
  // render (a plain ref assignment during render — safe, doesn't trigger
  // re-renders). Previously, toggling visibility off then back on created
  // a fresh layer seeded with an EMPTY array, leaving the map blank for
  // up to one full broadcast interval until the data-update effect below
  // happened to fire again. Now a freshly (re)created layer is seeded
  // with whatever data is current at creation time.
  pointsRef.current = points;

  // BUGFIX (A3 - critical): this effect now depends ONLY on [visible, map].
  // It creates the heat layer once when turned visible, and its cleanup
  // only fires when turned invisible or the component unmounts — not on
  // every data update. Previously `points` was in this same effect's
  // dependency array, so React's cleanup-then-rerun semantics meant the
  // layer was destroyed and recreated from scratch on every single tick
  // (the "reuse layer" setLatLngs branch below was actually unreachable
  // dead code, since layerRef.current had already been nulled by the
  // cleanup that ran immediately before).
  useEffect(() => {
    if (!visible) return undefined;

    layerRef.current = L.heatLayer(pointsRef.current, {
      radius: 32,
      blur: 28,
      maxZoom: 12,
      max: 1.0,
      gradient: {
        0.2: '#22c55e',
        0.4: '#eab308',
        0.6: '#f97316',
        0.85: '#dc2626',
        1.0: '#7f1d1d',
      },
    }).addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [visible, map]);

  // Separate effect: only pushes new point data into the existing layer.
  // No teardown/recreation here — this is the actual "live update" path.
  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setLatLngs(points);
    }
  }, [points]);

  return null;
}

export default function GISMap({ compact = false }) {
  const { t } = useLanguage();
  const { readingsByNode, nodes } = useTelemetryStream('*');
  const { readingsByTrap, traps } = usePestForecast('*');

  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRadii, setShowRadii] = useState(true);
  const [showTraps, setShowTraps] = useState(true);

  const nodeReadings = useMemo(() => Object.values(readingsByNode), [readingsByNode]);
  const heatPoints = useMemo(() => buildHeatPoints(nodeReadings), [nodeReadings]);
  const trapReadings = useMemo(() => Object.values(readingsByTrap), [readingsByTrap]);

  return (
    <Card padded={!compact}>
      {!compact && (
        <CardHeader
          icon={MapIcon}
          title={t('gisMap')}
          subtitle={t('gisSubtitle')}
        />
      )}

      {!compact && (
        <div className="flex flex-wrap items-center gap-5 mb-3 px-1">
          <Toggle size="sm" checked={showHeatmap} onChange={setShowHeatmap} label={t('ndviStress')} />
          <Toggle size="sm" checked={showRadii} onChange={setShowRadii} label={t('sensorRadius')} />
          <Toggle size="sm" checked={showTraps} onChange={setShowTraps} label={t('pestTraps')} />
        </div>
      )}

      <div className={`rounded-xl overflow-hidden border border-slate-800 ${compact ? 'h-64' : 'h-[28rem]'}`}>
        <MapContainer
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          scrollWheelZoom={!compact}
          dragging={!compact}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, FAO, NOAA, USGS'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />

          <NdviHeatLayer points={heatPoints} visible={showHeatmap} />

          {showRadii &&
            nodes.map((node) => (
              <Circle
                key={`radius-${node.nodeId}`}
                center={[node.lat, node.lng]}
                radius={node.radiusKm * 1000}
                pathOptions={{
                  color: '#22c55e',
                  weight: 1,
                  fillColor: '#22c55e',
                  fillOpacity: 0.06,
                  dashArray: '4 4',
                }}
              />
            ))}

          {nodeReadings.map((reading) => (
            <CircleMarker
              key={reading.nodeId}
              center={[reading.lat, reading.lng]}
              radius={9}
              pathOptions={{
                color: '#0f172a',
                weight: 2,
                fillColor: RISK_HEX[reading.risk.dominantRiskLevel] ?? RISK_HEX.LOW,
                fillOpacity: 0.95,
              }}
            >
              <Popup>
                <div className="min-w-[190px]">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-sm mb-1">
                    <Radio size={13} /> {reading.label}
                  </div>
                  <p className="text-xs text-slate-600 mb-1">
                    {reading.crop} · {reading.farmsServed} {t('farmsLabel')} · {reading.radiusKm} km {t('radiusLabel')}
                  </p>
                  <p className="text-xs text-slate-600 mb-2">
                    {reading.temperature.toFixed(1)}°C · {reading.humidity}% RH · LWD{' '}
                    {reading.lwdHours.toFixed(1)}h
                  </p>
                  <RiskBadge level={reading.risk.dominantRiskLevel} size="sm" />
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {showTraps &&
            trapReadings.map((trap) => (
              <CircleMarker
                key={trap.trapId}
                center={[trap.lat, trap.lng]}
                radius={7}
                pathOptions={{
                  color: '#0f172a',
                  weight: 2,
                  fillColor: trap.swarmImminent ? '#dc2626' : '#38bdf8',
                  fillOpacity: 0.95,
                }}
              >
                <Popup>
                  <div className="min-w-[180px]">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-sm mb-1">
                      <Bug size={13} /> {trap.label}
                    </div>
                    <p className="text-xs text-slate-600 mb-1">{trap.pestLabel}</p>
                    <p className="text-xs text-slate-600 mb-2">
                      {trap.nightlyCatch} {t('catchPerNight')} · {trap.degreeDay.percentToEmergence}% {t('toEmergence')}
                    </p>
                    {trap.swarmImminent ? (
                      <Badge color="amber" size="sm">
                        {t('swarmImminentTag')}
                      </Badge>
                    ) : (
                      <Badge color="blue" size="sm">
                        {t('monitoringTag')}
                      </Badge>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>

      {!compact && (
        <div className="flex items-center gap-4 mt-3 px-1 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <Satellite size={12} /> {t('simulatedNdviNote')}
          </span>
          <span className="flex items-center gap-1.5">
            <Layers size={12} /> {nodeReadings.length} {t('sensorNodesCount')} · {trapReadings.length} {t('trapsCountLabel')}
          </span>
        </div>
      )}
    </Card>
  );
}
