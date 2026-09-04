import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// maplibre-gl v6 ships only named ESM exports (no default export) — alias
// the `Map` class to avoid shadowing the global `Map` constructor.
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, ScatterplotLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
// In this deck.gl release TerrainExtension is still exported under its
// experimental underscore-prefixed name — aliased here so the rest of the
// file (and a future non-underscore upgrade) only needs a one-line change.
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
import {
  Mountain,
  Loader2,
  AlertTriangle,
  Bug,
  Droplets,
  Waves,
  Box as ColumnsIcon,
  Hexagon,
  Gauge,
  X,
} from 'lucide-react';
import { useTelemetryStream } from '../../hooks/useTelemetryStream.js';
import { usePestForecast } from '../../hooks/usePestForecast.js';
import {
  buildRiskGrid,
  idwInterpolate,
  sampleRiskValue,
  riskScoreToRGB,
  classifyRiskScore,
  RISK_BANDS,
} from '../../utils/spatialMlLogic.js';

/**
 * Geo-Farm — Real 3D Geospatial Outbreak Engine
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Photorealistic replacement for the old procedural Three.js terrain view:
 * a real MapLibre GL JS basemap with actual satellite imagery + a real
 * Digital Elevation Model (true mountains/valleys, not a displaced plane),
 * overlaid with deck.gl 3D extruded risk columns/hexbins whose height and
 * color are driven by a genuine IDW spatial interpolation of geotagged
 * field-sample risk data (see src/utils/spatialMlLogic.js).
 *
 * Zero paid API keys — see the tile-source constants below.
 *
 * Rendering-bug fixes baked into this implementation (see inline comments
 * at each site for the "why"):
 *   - Depth Buffer Alignment: deck.gl's MapboxOverlay is mounted in
 *     `interleaved: true` mode (shares the basemap's WebGL context/depth
 *     buffer instead of drawing to a separate overlaid canvas) AND every
 *     layer carries `extensions: [new TerrainExtension()]` + explicit
 *     `parameters: { depthTest: true }`, so pillars are vertex-snapped to
 *     the DEM surface and depth-tested against real terrain geometry —
 *     no floating above valleys, no clipping through hillsides.
 *   - Container Resizing & Canvas Bounds: the map container is a
 *     zero-margin `relative w-full h-full overflow-hidden` box, and a
 *     ResizeObserver drives `map.resize()` on every layout change instead
 *     of relying on the browser's native resize event (which never fires
 *     for container-only size changes, e.g. a parent flex/grid reflow).
 *   - Clean Unmounting: the effect below tears down, in order, the
 *     ResizeObserver, all bound map event listeners, the deck.gl overlay
 *     (`overlay.finalize()`), any in-flight hover animation frame, and
 *     finally `map.remove()` — which itself releases the WebGL context.
 *     Nothing here can outlive the component.
 */

// ---------------------------------------------------------------------------
// Free, zero-API-key tile sources
// ---------------------------------------------------------------------------
// Satellite imagery — Esri World Imagery. Public REST tile endpoint, no
// account, key, or token required (same provider already used for the 2D
// Leaflet basemap in GISMap.jsx, so both maps share one attribution story).
const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Elevation — AWS "Terrarium" DEM tiles: Mapzen's open elevation-tiles-prod
// dataset (derived from SRTM/ETOPO/3DEP/ASTER), hosted as public S3 objects
// with no auth of any kind. MapLibre decodes this PNG-encoded elevation
// format natively via `encoding: 'terrarium'` on a raster-dem source.
const TERRAIN_DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const MAP_CENTER = [74.2, 19.7]; // MapLibre uses [lng, lat] — Nashik/Rahuri midpoint
const INITIAL_ZOOM = 9.3;
const INITIAL_PITCH = 60;
const INITIAL_BEARING = -20;
const TERRAIN_EXAGGERATION = 1.6;

// Bounding box the IDW grid is interpolated across (roughly the Nashik –
// Rahuri agricultural corridor, matching GISMap's MAP_CENTER region).
const BOUNDS = { north: 20.35, south: 19.05, east: 75.15, west: 73.35 };

// ---------------------------------------------------------------------------
// Deterministic soil-moisture-stress sample set
// ---------------------------------------------------------------------------
// The app's live engines (telemetryService, pestForecast) cover fungal
// infection risk and pest emergence — there is no live soil-moisture sensor
// stream (yet), so this category is seeded deterministically, the same way
// GISMap.jsx seeds its NDVI heatmap jitter: a stable hash-based pseudo-RNG,
// not Math.random(), so the layer doesn't reshuffle every render/HMR.
function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
function seededUnit(seed, salt) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const SOIL_SAMPLE_SITES = [
  { id: 'SOIL-NSK-C1', lat: 20.03, lng: 73.8, label: 'Nashik Canal Field C1' },
  { id: 'SOIL-NSK-C2', lat: 19.95, lng: 73.86, label: 'Nashik Upland Plot C2' },
  { id: 'SOIL-RAH-C1', lat: 19.42, lng: 74.61, label: 'Rahuri Lowland Plot C1' },
  { id: 'SOIL-RAH-C2', lat: 19.36, lng: 74.7, label: 'Rahuri Ridge Field C2' },
  { id: 'SOIL-MID-C1', lat: 19.68, lng: 74.15, label: 'Mid-belt Transition Field' },
  { id: 'SOIL-MID-C2', lat: 19.75, lng: 74.35, label: 'Mid-belt Slope Field' },
  { id: 'SOIL-NSK-C3', lat: 20.1, lng: 73.95, label: 'Nashik Northern Block' },
  { id: 'SOIL-RAH-C3', lat: 19.3, lng: 74.55, label: 'Rahuri Southern Block' },
];

const SOIL_MOISTURE_SAMPLES = SOIL_SAMPLE_SITES.map((site) => {
  const seed = hashSeed(site.id);
  const severity = 0.15 + seededUnit(seed, 1.7) * 0.72;
  const diseaseConfidence = 0.45 + seededUnit(seed, 4.3) * 0.5;
  return { ...site, detail: site.label, severity, diseaseConfidence, category: 'soil' };
});

const CATEGORY_META = {
  fungal: { label: 'Fungal Blight', icon: Droplets, hint: 'Magarey infection model · live sensor nodes' },
  pest: { label: 'Pest Outbreak', icon: Bug, hint: 'Degree-day swarm forecast · live pheromone traps' },
  soil: { label: 'Soil Moisture Stress', icon: Waves, hint: 'Simulated soil-moisture sampling grid' },
};

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
const HEXAGON_COLOR_RANGE = RISK_BANDS.map((b) => hexToRgb(b.hex));

/** Combines live telemetry + pest-forecast streams with the seeded soil
 *  dataset into the three ML-classifier-shaped sample sets the HUD filters
 *  between. Memoized on the live engines' reading maps only — the soil
 *  dataset is a module-level constant. */
function useFieldSampleDatasets() {
  const { readingsByNode } = useTelemetryStream('*');
  const { readingsByTrap } = usePestForecast('*');

  return useMemo(() => {
    const fungal = Object.values(readingsByNode)
      .filter(Boolean)
      .map((r) => ({
        id: r.nodeId,
        lat: r.lat,
        lng: r.lng,
        label: r.label,
        detail: `${r.crop} · ${r.risk.dominantPathogen}`,
        severity: r.risk.dominantRiskScore,
        // telemetryService is a deterministic epidemiological model, not a
        // classifier, so it has no literal "confidence" field — proxy one
        // from how decisively the risk score sits in its band, so the IDW
        // math still gets a meaningful confidence-weighting input. A real
        // geotagged MobileNet scan (EdgeAIScanner + useGeolocation) would
        // feed `result.confidence` here directly instead.
        diseaseConfidence: Math.min(1, 0.6 + r.risk.dominantRiskScore * 0.4),
        category: 'fungal',
      }));

    const pest = Object.values(readingsByTrap)
      .filter(Boolean)
      .map((t) => ({
        id: t.trapId,
        lat: t.lat,
        lng: t.lng,
        label: t.label,
        detail: `${t.pestLabel} · ${t.nightlyCatch}/night`,
        severity: Math.min(1, t.degreeDay.percentToEmergence / 100),
        diseaseConfidence: t.swarmImminent ? 0.92 : 0.68,
        category: 'pest',
      }));

    return { fungal, pest, soil: SOIL_MOISTURE_SAMPLES };
  }, [readingsByNode, readingsByTrap]);
}

export default function Real3DTerrainMap({ onClose }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const hoverFrameRef = useRef(null);
  const activeSamplesRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [terrain3D, setTerrain3D] = useState(true);
  const [layerMode, setLayerMode] = useState('column'); // 'column' | 'hexagon'
  const [activeCategory, setActiveCategory] = useState('fungal');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const datasets = useFieldSampleDatasets();
  const activeSamples = datasets[activeCategory];

  useEffect(() => {
    activeSamplesRef.current = activeSamples;
  }, [activeSamples]);

  // --- Hover: recompute a fresh IDW read at the exact cursor position ------
  // Throttled to one calculation per animation frame (not per mousemove
  // event, which can fire far faster than the screen refreshes) via a
  // requestAnimationFrame gate. Reads samples from a ref rather than a
  // closed-over variable so switching the HUD's category filter is
  // reflected immediately without needing to re-bind the map listener.
  const handleMouseMove = useCallback((e) => {
    if (hoverFrameRef.current != null) return;
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      const { lng, lat } = e.lngLat;

      let elevationM = null;
      try {
        elevationM = typeof map.queryTerrainElevation === 'function' ? map.queryTerrainElevation(e.lngLat) : null;
      } catch {
        elevationM = null; // terrain tile not yet loaded at this point — non-fatal
      }

      const idw = idwInterpolate(lat, lng, activeSamplesRef.current, { maxNeighbors: 6 });
      setHoverInfo({
        x: e.point.x,
        y: e.point.y,
        lat,
        lng,
        elevationM,
        riskScore: idw.riskScore,
        confidence: idw.confidence,
        nearestSample: idw.nearestSample,
        nearestDistanceKm: idw.nearestDistanceKm,
      });
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    setHoverInfo(null);
  }, []);

  // --- Map lifecycle: create once, tear down fully on unmount --------------
  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      },
      center: MAP_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: INITIAL_BEARING,
      maxPitch: 78,
      antialias: true,
      attributionControl: true,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;

    const handleError = (evt) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error('[Real3DTerrainMap] map error', evt?.error);
      setMapError('Map tiles failed to load. Check your connection and retry.');
    };
    map.on('error', handleError);

    const handleLoad = () => {
      if (cancelled) return;
      try {
        map.addSource('satellite', {
          type: 'raster',
          tiles: [SATELLITE_TILE_URL],
          tileSize: 256,
          maxzoom: 18,
          attribution: 'Esri, Maxar, Earthstar Geographics, USDA FSA, USGS',
        });
        map.addLayer({ id: 'satellite-base', type: 'raster', source: 'satellite' });

        map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: [TERRAIN_DEM_URL],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15,
          attribution: 'Elevation \u00a9 Mapzen elevation-tiles-prod, \u00a9 OpenStreetMap contributors',
        });
        map.setTerrain({ source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION });

        // Hillshade beneath the satellite raster for extra depth cueing on
        // ridgelines/valleys the raw imagery alone doesn't make obvious.
        map.addLayer(
          {
            id: 'hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#1a1006' },
          },
          'satellite-base'
        );

        if (typeof map.setSky === 'function') {
          map.setSky({
            'sky-color': '#0b1830',
            'sky-horizon-blend': 0.55,
            'horizon-color': '#a7c1e0',
            'horizon-fog-blend': 0.6,
            'fog-color': '#cfe0f2',
            'fog-ground-blend': 0.4,
          });
        }

        map.addControl(overlay);
        setMapLoaded(true);
      } catch (err) {
        handleError({ error: err });
      }
    };
    map.on('load', handleLoad);
    map.on('mousemove', handleMouseMove);
    map.on('mouseleave', handleMouseLeave);

    // Container Resizing & Canvas Bounds fix: ResizeObserver instead of
    // `window.resize` — a parent flex/grid/modal reflow changes this
    // container's size without ever firing a window resize event, which
    // is what caused the old canvas stretch/overflow bug.
    const resizeObserver = new ResizeObserver((entries) => {
      if (cancelled || !containerRef.current) return;
      const entry = entries[0];
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (hoverFrameRef.current != null) {
        cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      map.off('error', handleError);
      map.off('load', handleLoad);
      map.off('mousemove', handleMouseMove);
      map.off('mouseleave', handleMouseLeave);
      try {
        overlay.finalize?.();
      } catch {
        /* best-effort deck.gl GPU teardown */
      }
      try {
        map.remove(); // releases the WebGL context + every maplibre resource
      } catch {
        /* map may already be torn down if init failed mid-flight */
      }
      mapRef.current = null;
      overlayRef.current = null;
    };
    // Mount once. HUD interactions below talk to mapRef/overlayRef
    // directly rather than re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 3D Terrain Toggle: 2D Flat <-> 3D Topography -------------------------
  const toggleTerrainMode = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    setTerrain3D((prev) => {
      const next = !prev;
      map.easeTo({ pitch: next ? INITIAL_PITCH : 0, bearing: next ? INITIAL_BEARING : 0, duration: 900 });
      map.setTerrain(next ? { source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION } : null);
      return next;
    });
  }, [mapLoaded]);

  // --- ML spatial risk grid: real IDW interpolation over the active category
  const grid = useMemo(
    () => buildRiskGrid(activeSamples, BOUNDS, { cols: 30, rows: 22, maxNeighbors: 6 }),
    [activeSamples]
  );

  // --- Deck.gl layers: rebuilt whenever the grid, render mode, or terrain
  // mode changes; pushed into the live overlay by the effect below.
  const layers = useMemo(() => {
    if (!mapLoaded || grid.length === 0) return [];

    // Depth Buffer Alignment fix: TerrainExtension snaps each layer's
    // rendered geometry onto the DEM surface height (so pillars sit flush
    // with real terrain) — only meaningful while 3D terrain is active; in
    // flat mode there's no elevation surface to snap to, so columns are
    // drawn from sea level (z = 0) instead.
    const extensions = terrain3D ? [new TerrainExtension()] : [];
    const glParameters = { depthTest: true };
    const materialProps = { ambient: 0.5, diffuse: 0.7, shininess: 24, specularColor: [255, 255, 255] };

    const sampleLayer = new ScatterplotLayer({
      id: 'verified-farm-samples',
      data: activeSamples,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 140,
      radiusUnits: 'meters',
      getFillColor: (d) => [...riskScoreToRGB(sampleRiskValue(d)), 235],
      getLineColor: [15, 23, 42, 255],
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: false,
      parameters: glParameters,
      extensions,
    });

    if (layerMode === 'hexagon') {
      const hexLayer = new HexagonLayer({
        id: 'risk-hexagon-layer',
        data: grid,
        getPosition: (d) => [d.lng, d.lat],
        getElevationWeight: (d) => d.riskScore,
        getColorWeight: (d) => d.riskScore,
        elevationAggregation: 'MEAN',
        colorAggregation: 'MEAN',
        radius: 2200,
        coverage: 0.82,
        elevationScale: 220,
        extruded: true,
        colorRange: HEXAGON_COLOR_RANGE,
        pickable: true,
        parameters: glParameters,
        extensions,
        material: materialProps,
      });
      return [hexLayer, sampleLayer];
    }

    const columnLayer = new ColumnLayer({
      id: 'risk-column-layer',
      data: grid,
      diskResolution: 6,
      radius: 950,
      extruded: true,
      getPosition: (d) => [d.lng, d.lat],
      getElevation: (d) => 60 + d.riskScore * 420,
      getFillColor: (d) => [...riskScoreToRGB(d.riskScore), Math.round(120 + d.confidence * 135)],
      getLineColor: [15, 23, 42, 120],
      lineWidthMinPixels: 1,
      pickable: true,
      parameters: glParameters,
      extensions,
      material: materialProps,
    });
    return [columnLayer, sampleLayer];
  }, [grid, layerMode, terrain3D, activeSamples, mapLoaded]);

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({ layers });
    }
  }, [layers]);

  const hoverTooltipStyle = useMemo(() => {
    if (!hoverInfo) return null;
    const TOOLTIP_WIDTH = 232;
    const left = Math.min(hoverInfo.x + 14, Math.max(8, containerSize.width - TOOLTIP_WIDTH - 8));
    const top = Math.min(hoverInfo.y + 14, Math.max(8, containerSize.height - 140));
    return { left, top, width: TOOLTIP_WIDTH };
  }, [hoverInfo, containerSize]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl bg-slate-950">
      <div ref={containerRef} className="absolute inset-0" />

      {!mapLoaded && !mapError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 text-slate-300 pointer-events-none">
          <Loader2 className="animate-spin" size={22} />
          <p className="text-xs">Loading satellite imagery &amp; DEM terrain…</p>
        </div>
      )}

      {mapError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/97 text-center px-6">
          <AlertTriangle size={26} className="text-risk-severe" />
          <p className="text-sm text-slate-200 max-w-xs">{mapError}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-semibold text-farm-400 hover:text-farm-300 underline"
          >
            Reload
          </button>
        </div>
      )}

      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 bg-slate-950/60 hover:bg-slate-900/80 backdrop-blur border border-white/10 transition-colors"
          aria-label="Close 3D terrain map"
        >
          <X size={16} />
        </button>
      )}

      {mapLoaded && (
        <>
          {/* Glassmorphism HUD */}
          <div className="absolute top-3 left-3 z-10 w-[210px] rounded-xl border border-white/15 bg-slate-950/55 backdrop-blur-md p-3 shadow-2xl space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100 uppercase tracking-wide">
              <Mountain size={13} className="text-farm-400" /> Terrain HUD
            </div>

            <button
              onClick={toggleTerrainMode}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                terrain3D
                  ? 'bg-farm-600/25 border-farm-500/50 text-farm-300'
                  : 'bg-white/5 border-white/15 text-slate-300'
              }`}
            >
              <span>{terrain3D ? '3D Topography' : '2D Flat'}</span>
              <span className="text-[9px] opacity-70">toggle</span>
            </button>

            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wide text-slate-400">ML Risk Layer</p>
              {Object.entries(CATEGORY_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const active = activeCategory === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveCategory(key)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                      active
                        ? 'bg-saffron-500/20 border-saffron-500/50 text-saffron-300'
                        : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <Icon size={12} /> {meta.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wide text-slate-400">Surface Render</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setLayerMode('column')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                    layerMode === 'column'
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-white/5 border-white/10 text-slate-400'
                  }`}
                >
                  <ColumnsIcon size={11} /> Columns
                </button>
                <button
                  onClick={() => setLayerMode('hexagon')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                    layerMode === 'hexagon'
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-white/5 border-white/10 text-slate-400'
                  }`}
                >
                  <Hexagon size={11} /> Hex Bins
                </button>
              </div>
            </div>

            <p className="text-[9px] text-slate-500 leading-snug pt-2 border-t border-white/10">
              {CATEGORY_META[activeCategory].hint} · {activeSamples.length} verified samples · IDW-interpolated
            </p>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-10 rounded-xl border border-white/15 bg-slate-950/55 backdrop-blur-md px-3 py-2 flex items-center gap-3 text-[10px] text-slate-300">
            {['#10b981', '#f59e0b', '#dc2626'].map((hex, i) => (
              <span key={hex} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: hex }} />
                {['Low', 'Moderate', 'Severe'][i]}
              </span>
            ))}
          </div>

          {/* Hover tooltip: interpolated ML risk score, satellite elevation, nearest verified sample */}
          {hoverInfo && hoverTooltipStyle && (
            <div
              className="absolute z-20 pointer-events-none rounded-lg border border-white/15 bg-slate-950/85 backdrop-blur-md px-3 py-2 text-[11px] text-slate-200 shadow-2xl"
              style={hoverTooltipStyle}
            >
              <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                <Gauge size={12} className="text-saffron-400" />
                {Math.round(hoverInfo.riskScore * 100)}% risk
                <span className="text-[9px] text-slate-500 font-normal">
                  ({classifyRiskScore(hoverInfo.riskScore).level})
                </span>
              </div>
              <p className="text-slate-400 mt-1">
                Elevation: {hoverInfo.elevationM != null ? `${Math.round(hoverInfo.elevationM)} m` : '—'}
              </p>
              <p className="text-slate-400">
                Nearest sample:{' '}
                {hoverInfo.nearestSample
                  ? `${hoverInfo.nearestSample.label ?? hoverInfo.nearestSample.id} (${hoverInfo.nearestDistanceKm.toFixed(1)} km)`
                  : 'none in range'}
              </p>
              <p className="text-slate-600 text-[9px] mt-1">IDW confidence {Math.round(hoverInfo.confidence * 100)}%</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
