import React, { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Geo-Farm — Leaf Heatmap Canvas
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Renders two things on a transparent canvas positioned absolutely over the
 * scanned leaf image:
 *   1. A semi-transparent NxN grid heatmap (green -> amber -> red) from
 *      aiScannerEngine.computeStressHeatmapGrid()'s `grid` output — a
 *      lesion-density spatial proxy, explicitly NOT a true Grad-CAM (see
 *      the honesty note in aiScannerEngine.js).
 *   2. A bounding-box highlight (corner-bracket style, matches the app's
 *      "high-trust" visual language) around the hottest cluster.
 *
 * Interactive: hovering a cell shows its intensity in a small tooltip.
 * Purely presentational otherwise — no tensors, no network, no timers
 * beyond a single resize-driven redraw, so the only cleanup needed is the
 * ResizeObserver disconnect on unmount (covered below).
 */

const CELL_COLOR_STOPS = [
  { t: 0.0, color: [34, 197, 94] }, // emerald-500 (healthy)
  { t: 0.5, color: [245, 158, 11] }, // amber-500
  { t: 1.0, color: [239, 68, 68] }, // red-500 (critical)
];

function lerpColor(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  for (let i = 0; i < CELL_COLOR_STOPS.length - 1; i++) {
    const a = CELL_COLOR_STOPS[i];
    const b = CELL_COLOR_STOPS[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const localT = (clamped - a.t) / (b.t - a.t || 1);
      return a.color.map((c, idx) => Math.round(c + (b.color[idx] - c) * localT));
    }
  }
  return CELL_COLOR_STOPS[CELL_COLOR_STOPS.length - 1].color;
}

/**
 * @param {{
 *   grid: number[][] | null,          // NxN intensity values 0-1
 *   boundingBox: {x:number,y:number,w:number,h:number} | null, // normalized 0-1
 *   visible?: boolean,                 // toggle overlay on/off
 *   className?: string,
 * }} props
 */
export default function LeafHeatmapCanvas({ grid, boundingBox, visible = true, className = '' }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoverCell, setHoverCell] = useState(null); // {row, col, intensity} | null

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !grid) return;

    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;

    // Match canvas backing resolution to the container's actual rendered
    // size (including devicePixelRatio) so the overlay stays crisp instead
    // of blurry-upscaled on high-DPI phone screens.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!visible) return;

    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    const cellW = w / cols;
    const cellH = h / rows;

    // Heatmap grid
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const intensity = grid[row][col];
        if (intensity < 0.08) continue; // skip near-zero cells — keeps healthy areas clean
        const [r, g, b] = lerpColor(intensity);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + intensity * 0.35})`;
        ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
      }
    }

    // Bounding box — corner-bracket style rather than a plain rectangle,
    // matching the "high-trust decision support" visual language requested.
    if (boundingBox) {
      const bx = boundingBox.x * w;
      const by = boundingBox.y * h;
      const bw = boundingBox.w * w;
      const bh = boundingBox.h * h;
      drawCornerBrackets(ctx, bx, by, bw, bh);
    }
  }, [grid, boundingBox, visible]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on container resize (e.g. orientation change, modal resize) —
  // ResizeObserver is disconnected on unmount, the only real cleanup this
  // purely-presentational component needs.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const handleMouseMove = (e) => {
    if (!grid || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cols = grid[0]?.length ?? 0;
    const rows = grid.length;
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y / rect.height) * rows)));
    const intensity = grid[row]?.[col];
    if (intensity !== undefined) {
      setHoverCell({ row, col, intensity, x, y });
    }
  };

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 pointer-events-auto ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverCell(null)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {hoverCell && (
        <div
          className="absolute z-10 pointer-events-none rounded-md bg-slate-950/90 border border-slate-700 px-2 py-1 text-[10px] font-mono text-slate-200 -translate-x-1/2 -translate-y-full"
          style={{ left: hoverCell.x, top: hoverCell.y - 6 }}
        >
          stress {Math.round(hoverCell.intensity * 100)}%
        </div>
      )}
    </div>
  );
}

function drawCornerBrackets(ctx, x, y, w, h, bracketLen = Math.min(w, h) * 0.22) {
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  const corners = [
    // [cornerX, cornerY, dirX, dirY] — dir indicates which way each bracket arm points inward
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];

  corners.forEach(([cx, cy, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + bracketLen * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + bracketLen * dx, cy);
    ctx.stroke();
  });

  ctx.restore();
}
