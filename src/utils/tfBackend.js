import * as tf from '@tensorflow/tfjs';

/**
 * Geo-Farm — TensorFlow.js Backend Manager
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * AUDIT FINDING (Principal Engineer review): the app previously called
 * `tf.ready()` with no explicit backend selection and no recovery path.
 * On low-memory mobile devices or after many WebGL contexts accumulate on
 * a single page (Leaflet tiles + tfjs both use WebGL/canvas resources),
 * the browser can silently lose the WebGL context mid-session. Every
 * subsequent `model.classify()` call then throws, and the old code mapped
 * that straight to a generic "scan failed" message with no way to recover
 * short of a full page reload.
 *
 * This module:
 *   1. Explicitly tries backends in priority order: webgl -> wasm -> cpu.
 *   2. Registers `webglcontextlost` / `webglcontextrestored` listeners on
 *      the tfjs-owned WebGL canvas (when the webgl backend is active) so a
 *      lost context automatically demotes the app to CPU/WASM instead of
 *      leaving every inference call broken.
 *   3. Exposes `getActiveBackend()` / `onBackendChange()` so UI can surface
 *      degraded-mode state (e.g. "Running in reduced-performance mode").
 */

const WASM_VERSION = tf.version_core ?? tf.version?.['tfjs-core'];
// jsDelivr mirrors the exact npm package, so the WASM binary version always
// matches whatever @tensorflow/tfjs-backend-wasm resolves to at build time.
const WASM_CDN_BASE = WASM_VERSION
  ? `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${WASM_VERSION}/dist/`
  : null;

let activeBackend = null;
let contextLossBound = false;
const listeners = new Set();

function notify(status) {
  activeBackend = status;
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (err) {
      // Never let a listener's own error break backend management.
      console.error('[Geo-Farm] tfBackend listener threw:', err);
    }
  });
}

export function onBackendChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActiveBackend() {
  return activeBackend;
}

/** Attempts to bind WebGL context-loss/restore handlers to the canvas tfjs
 *  is currently rendering through. Defensive by design: the internal
 *  GPGPU/canvas accessors are undocumented private tfjs APIs that can
 *  change between versions, so every step is feature-checked and wrapped —
 *  failure to bind simply means we skip auto-recovery, never a crash. */
function bindWebglContextLossRecovery() {
  if (contextLossBound) return;
  try {
    const backend = tf.backend?.();
    const gl =
      backend?.getGPGPUContext?.()?.gl ??
      backend?.gpgpu?.gl ??
      null;
    const canvas = gl?.canvas;
    if (!canvas || typeof canvas.addEventListener !== 'function') return;

    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        // Prevent the browser's default "unrecoverable" teardown so a
        // future `webglcontextrestored` event has a chance to fire.
        event.preventDefault();
        console.warn('[Geo-Farm] WebGL context lost — falling back to a CPU/WASM backend.');
        notify('context-lost');
        // Demote immediately; inference must keep working even if the
        // context never comes back on this device.
        initTFBackend({ preferWebgl: false }).catch((err) =>
          console.error('[Geo-Farm] Backend fallback after context loss failed:', err)
        );
      },
      false
    );

    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        console.info('[Geo-Farm] WebGL context restored.');
        notify('context-restored');
      },
      false
    );

    contextLossBound = true;
  } catch (err) {
    // Private API shape changed or unavailable on this platform — safe to
    // continue without auto-recovery.
    console.warn('[Geo-Farm] Could not bind WebGL context-loss recovery:', err);
  }
}

/**
 * Initializes the best available tfjs backend.
 * @param {{ preferWebgl?: boolean }} options — pass `{ preferWebgl: false }`
 *   to skip straight to WASM/CPU (used by the context-loss recovery path).
 * @returns {Promise<'webgl' | 'wasm' | 'cpu'>}
 */
export async function initTFBackend({ preferWebgl = true } = {}) {
  if (preferWebgl) {
    try {
      await tf.setBackend('webgl');
      await tf.ready();
      bindWebglContextLossRecovery();
      notify('webgl');
      return 'webgl';
    } catch (err) {
      console.warn('[Geo-Farm] WebGL backend unavailable, trying WASM:', err?.message ?? err);
    }
  }

  if (WASM_CDN_BASE) {
    try {
      const { setWasmPaths } = await import('@tensorflow/tfjs-backend-wasm');
      setWasmPaths(WASM_CDN_BASE);
      await tf.setBackend('wasm');
      await tf.ready();
      notify('wasm');
      return 'wasm';
    } catch (err) {
      console.warn('[Geo-Farm] WASM backend unavailable, falling back to CPU:', err?.message ?? err);
    }
  }

  // CPU is bundled in the core @tensorflow/tfjs package and always works —
  // final guaranteed fallback so the scanner degrades gracefully instead
  // of failing outright.
  await tf.setBackend('cpu');
  await tf.ready();
  notify('cpu');
  return 'cpu';
}

/** Dev-mode leak sentinel: call before/after an inference pass. Logs a
 *  warning (never throws) if tensor count grows beyond what a single
 *  classify() call should leave behind, surfacing future regressions
 *  early instead of silently accumulating GPU memory. */
export function tensorLeakGuard(label, baselineNumTensors) {
  if (!import.meta.env?.DEV) return;
  try {
    const { numTensors, numBytes } = tf.memory();
    const grew = numTensors - baselineNumTensors;
    if (grew > 0) {
      console.warn(
        `[Geo-Farm][tf-leak-guard] "${label}" left ${grew} tensor(s) undisposed ` +
          `(numTensors=${numTensors}, numBytes=${numBytes}).`
      );
    }
  } catch (err) {
    // Diagnostics must never affect the actual scan flow.
  }
}
