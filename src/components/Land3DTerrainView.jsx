import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw, Radio as RadioIcon, X, Send } from 'lucide-react';
import { RiskBadge } from './ui/Badge.jsx';

/**
 * Geo-Farm — 3D Infected-Land Terrain View
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Gives a government officer an immediate, physical sense of an outbreak:
 * a live 3D field where the exact patch of land under threat visibly
 * rises, cracks, and glows at the epicenter, with drifting particles
 * (spores for disease, swarm motes for pests) radiating outward. Built
 * with plain Three.js (no extra framework) so it stays lightweight and
 * mounts/unmounts cleanly inside the existing Modal system.
 *
 * Props:
 *   open      — boolean, whether the view is visible
 *   onClose   — () => void
 *   site      — {
 *     label, crop, district, riskLevel, riskScore (0-1),
 *     pathogen, kind: 'disease' | 'pest', lat, lng
 *   }
 *   onDispatch — optional () => void, wired to a real action (e.g. jump to
 *                Officer Dashboard / Alert Center) if provided
 */

const RISK_COLOR = {
  LOW: 0x22c55e,
  MODERATE: 0xeab308,
  HIGH: 0xf97316,
  SEVERE: 0xdc2626,
  CRITICAL: 0x7f1d1d,
};

const HEALTHY_GREEN = new THREE.Color(0x1f7a3f);
const SOIL_BROWN = new THREE.Color(0x4a2f1a);

export default function Land3DTerrainView({ open, onClose, site, onDispatch }) {
  const containerRef = useRef(null);
  const stateRef = useRef(null); // holds all Three.js objects for cleanup
  const [autoRotating, setAutoRotating] = useState(true);

  // FIX (medium, stale UI state): Land3DTerrainView is always mounted by
  // GISMap (only its `open` prop toggles), so returning `null` below does
  // NOT unmount this component or reset its hooks. Previously,
  // `autoRotating` was plain component state — rotating one outbreak site
  // manually, closing the view, then opening a DIFFERENT site left
  // `autoRotating` stuck at `false` from the previous session: the new
  // scene's `controls.autoRotate` is freshly `true` (set in the effect
  // below), but the "Resume auto-rotate" button stayed visible and
  // out-of-sync with the actual camera behavior. Resetting here, keyed to
  // the same `open`/`site` transition that rebuilds the scene, keeps the
  // button's visibility truthful for every new site.
  useEffect(() => {
    if (open) setAutoRotating(true);
  }, [open, site]);

  useEffect(() => {
    if (!open || !containerRef.current || !site) return undefined;

    const container = containerRef.current;
    const riskColorHex = RISK_COLOR[site.riskLevel] ?? RISK_COLOR.MODERATE;
    const riskScore = Math.max(0.1, Math.min(1, site.riskScore ?? 0.5));
    const dangerColor = new THREE.Color(riskColorHex);

    // --- Renderer / Scene / Camera ---------------------------------------
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0f1a, 0.028);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(11, 9, 13);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.9;
    controls.target.set(0, 0, 0);
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      setAutoRotating(false);
    });

    // --- Lighting ----------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x1a1005, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.4);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    scene.add(sun);
    const fillLight = new THREE.PointLight(dangerColor, 6, 14, 2);
    fillLight.position.set(0, 2.5, 0);
    scene.add(fillLight);

    // --- Terrain: displaced + vertex-colored plane -------------------------
    const SIZE = 20;
    const SEGMENTS = 56;
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    const posAttr = geometry.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const hotspotRadius = 3.2 + riskScore * 2.4;

    for (let i = 0; i < posAttr.count; i += 1) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i); // pre-rotation "y" maps to world Z (depth)
      const dist = Math.sqrt(x * x + y * y);

      // Gentle ambient undulation so the field doesn't look like a flat slab.
      const ambient =
        Math.sin(x * 0.5) * 0.12 + Math.cos(y * 0.45) * 0.12 + Math.sin((x + y) * 0.3) * 0.06;

      // Outbreak bump: land visibly rises and roughens at the epicenter.
      const influence = Math.max(0, 1 - dist / hotspotRadius);
      const bump = Math.pow(influence, 1.6) * (1.4 + riskScore * 2.2);
      const jaggedness = influence > 0.15 ? (Math.sin(x * 6 + y * 7) * 0.18 * influence) : 0;

      posAttr.setZ(i, ambient + bump + jaggedness);

      const mixed = HEALTHY_GREEN.clone().lerp(dangerColor, Math.pow(influence, 1.1) * riskScore);
      const soilMix = mixed.lerp(SOIL_BROWN, influence * 0.35);
      colors[i * 3] = soilMix.r;
      colors[i * 3 + 1] = soilMix.g;
      colors[i * 3 + 2] = soilMix.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false,
    });
    const terrain = new THREE.Mesh(geometry, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);

    // --- Crop rows: small instanced plants, wilting near the epicenter -----
    const ROWS = 16;
    const COLS = 16;
    const plantGeo = new THREE.ConeGeometry(0.12, 0.4, 6);
    const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const plants = new THREE.InstancedMesh(plantGeo, plantMat, ROWS * COLS);
    plants.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ROWS * COLS * 3), 3);
    plants.castShadow = true;

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const px = (r / (ROWS - 1) - 0.5) * (SIZE - 1.5);
        const pz = (c / (COLS - 1) - 0.5) * (SIZE - 1.5);
        const dist = Math.sqrt(px * px + pz * pz);
        const influence = Math.max(0, 1 - dist / hotspotRadius);
        const ambient = Math.sin(px * 0.5) * 0.12 + Math.cos(pz * 0.45) * 0.12;
        const bump = Math.pow(influence, 1.6) * (1.4 + riskScore * 2.2);
        const py = ambient + bump;
        const wilt = Math.pow(influence, 1.2) * riskScore;

        dummy.position.set(px, py + 0.2 * (1 - wilt * 0.7), pz);
        dummy.rotation.set((Math.random() - 0.5) * wilt * 1.2, Math.random() * Math.PI, (Math.random() - 0.5) * wilt * 1.2);
        dummy.scale.setScalar(1 - wilt * 0.55 + Math.random() * 0.08);
        dummy.updateMatrix();
        plants.setMatrixAt(idx, dummy.matrix);

        const plantColor = HEALTHY_GREEN.clone().lerp(dangerColor, wilt);
        plants.setColorAt(idx, plantColor);
        idx += 1;
      }
    }
    plants.instanceMatrix.needsUpdate = true;
    if (plants.instanceColor) plants.instanceColor.needsUpdate = true;
    scene.add(plants);

    // --- Epicenter marker: pulsing beam + expanding ring rings --------------
    const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 5, 8);
    const beamMat = new THREE.MeshBasicMaterial({ color: dangerColor, transparent: true, opacity: 0.85 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 2.5 + hotspotRadius * 0.15, 0);
    scene.add(beam);

    const rings = [0, 1, 2].map((i) => {
      const ringGeo = new THREE.RingGeometry(0.4, 0.55, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: dangerColor,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.userData.phase = i * 0.66;
      scene.add(ring);
      return ring;
    });

    // --- Floating particles: spores / pest swarm motes ----------------------
    const PARTICLE_COUNT = 140;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(PARTICLE_COUNT * 3);
    const particleSpeed = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * hotspotRadius;
      particlePos[i * 3] = Math.cos(angle) * radius;
      particlePos[i * 3 + 1] = Math.random() * 3;
      particlePos[i * 3 + 2] = Math.sin(angle) * radius;
      particleSpeed[i] = 0.3 + Math.random() * 0.6;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: dangerColor,
      size: site.kind === 'pest' ? 0.09 : 0.06,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // --- Resize handling ------------------------------------------------
    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    // --- Animation loop ---------------------------------------------------
    const clock = new THREE.Clock();
    let frameId;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      beam.scale.y = 1 + Math.sin(t * 2.2) * 0.15 * riskScore;
      beamMat.opacity = 0.55 + Math.sin(t * 2.2) * 0.25 * riskScore;

      rings.forEach((ring) => {
        const local = (t * 0.5 + ring.userData.phase) % 1.5;
        const scale = 0.4 + local * hotspotRadius;
        ring.scale.set(scale, scale, scale);
        ring.material.opacity = Math.max(0, 0.6 - local * 0.4);
      });

      const posArr = particleGeo.attributes.position.array;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        posArr[i * 3 + 1] += particleSpeed[i] * 0.01;
        if (posArr[i * 3 + 1] > 3.2) posArr[i * 3 + 1] = 0;
      }
      particleGeo.attributes.position.needsUpdate = true;
      particles.rotation.y = t * 0.05;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    stateRef.current = { renderer, scene, controls, resizeObserver, frameId: () => frameId };

    // --- Full cleanup on unmount / close: dispose every GPU resource -------
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      terrainMat.dispose();
      // AUDIT FIX (Medium — GPU memory leak): `plants` is a THREE.InstancedMesh,
      // which owns its OWN GPU-resident instanceMatrix/instanceColor buffers
      // separate from `plantGeo`/`plantMat` (those only cover the single
      // shared cone geometry/material, not the per-instance transform/color
      // arrays). WebGLRenderer only releases those instance buffers when the
      // mesh's own `dispose()` fires its 'dispose' event — disposing the
      // geometry/material alone does NOT free them. Without this call, every
      // time an officer opens a different outbreak site (this effect re-runs
      // on `site` change while the modal stays open) leaked instance buffers
      // for 256 cone instances accumulate in the renderer's WebGL properties
      // map for the lifetime of the tab.
      plants.dispose();
      plantGeo.dispose();
      plantMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        ring.material.dispose();
      });
      scene.clear();
      stateRef.current = null;
    };
  }, [open, site]);

  const handleResetView = () => {
    setAutoRotating(true);
    if (stateRef.current) {
      stateRef.current.controls.autoRotate = true;
    }
  };

  if (!open || !site) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl h-[85vh] rounded-2xl overflow-hidden border border-slate-700/60 bg-surface-950 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-surface-900/80 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{site.label}</p>
            <p className="text-xs text-slate-400 truncate">
              {site.crop} · {site.district ?? 'Maharashtra'} · {site.pathogen}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RiskBadge level={site.riskLevel} pulse />
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg p-1.5 transition-colors"
              aria-label="Close 3D view"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 3D canvas container */}
        <div className="relative flex-1 min-h-0">
          <div ref={containerRef} className="absolute inset-0" />

          {/* Overlay: controls hint + reset */}
          <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-slate-400 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg">
            <RadioIcon size={12} className="text-farm-400" />
            Drag to rotate · scroll to zoom
          </div>
          {!autoRotating && (
            <button
              onClick={handleResetView}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-200 bg-black/50 hover:bg-black/70 backdrop-blur px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <RotateCcw size={12} /> Resume auto-rotate
            </button>
          )}
        </div>

        {/* Footer: action bar for the officer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-surface-900/80 shrink-0">
          <p className="text-xs text-slate-500">
            Risk score: <span className="text-slate-300 font-medium">{Math.round((site.riskScore ?? 0) * 100)}%</span>
            {site.lat != null && (
              <span className="ml-3">
                {site.lat.toFixed(4)}, {site.lng.toFixed(4)}
              </span>
            )}
          </p>
          {onDispatch && (
            <button
              onClick={onDispatch}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-farm-600 hover:bg-farm-500 transition-colors shadow-glow"
            >
              <Send size={14} /> Take Action
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
