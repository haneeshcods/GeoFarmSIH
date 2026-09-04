import { useEffect, useRef, useState, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { initTFBackend, tensorLeakGuard } from '../utils/tfBackend.js';

/**
 * Geo-Farm — useMobileNetModel
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * AUDIT FINDINGS FIXED (previously inlined directly in EdgeAIScanner.jsx):
 *
 *   1. [CRITICAL] The loaded MobileNet GraphModel was never disposed on
 *      unmount. EdgeAIScanner is now mounted/unmounted repeatedly (it's
 *      rendered inside a Modal from the Student dashboard's "Launch AI Crop
 *      Scanner" button, in addition to the sidebar nav panel), so every
 *      open re-downloaded/re-registered a full set of GPU-resident weight
 *      tensors without freeing the previous instance — an unbounded WebGL
 *      memory leak across a single session. `@tensorflow-models/mobilenet`
 *      does not publicly document a `.dispose()` method, but the
 *      underlying `tf.GraphModel` it wraps (`instance.model`) does; we call
 *      it defensively (feature-checked, try/caught) on unmount.
 *   2. [HIGH] No backend fallback / WebGL context-loss recovery — delegated
 *      to `initTFBackend()` (see utils/tfBackend.js) instead of a bare
 *      `tf.ready()`.
 *   3. [MEDIUM] Model-load effect already guarded against post-unmount
 *      `setState` via a `cancelled` flag — preserved here.
 */
export function useMobileNetModel() {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [backend, setBackend] = useState(null);
  const modelRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const activeBackend = await initTFBackend();
        if (cancelled) return;
        setBackend(activeBackend);

        const loadedModel = await mobilenet.load({ version: 2, alpha: 1.0 });
        if (cancelled) {
          // Component unmounted while the model was still downloading —
          // dispose immediately rather than leaving it referenced only by
          // this closure (which would otherwise still hold GPU memory
          // until GC, with no guarantee tfjs tensors are GC-collected
          // promptly since they live outside the JS heap).
          try {
            loadedModel?.model?.dispose?.();
          } catch (disposeErr) {
            // best-effort — nothing more we can do post-unmount
          }
          return;
        }
        modelRef.current = loadedModel;
        setStatus('ready');
      } catch (err) {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      // FIX (memory leak): release the GraphModel's GPU-resident weight
      // tensors when this hook's owner unmounts. `.model` is an internal
      // (undocumented) property of the mobilenet wrapper, so every access
      // is optional-chained and wrapped — a future package upgrade that
      // removes/renames it degrades to "no explicit dispose" rather than
      // throwing during unmount.
      try {
        modelRef.current?.model?.dispose?.();
      } catch (err) {
        console.warn('[Geo-Farm] Failed to dispose MobileNet model on unmount:', err);
      } finally {
        modelRef.current = null;
      }
    };
  }, []);

  /** Runs `classify()` with a tensor-leak sentinel around it and normalizes
   *  errors (including a WebGL-context-loss-specific message) instead of
   *  letting a raw tfjs error string reach the UI. */
  const classify = useCallback(async (sourceEl, topk = 3) => {
    if (!modelRef.current) {
      throw new Error('MODEL_NOT_READY');
    }
    const baseline = tf.memory().numTensors;
    try {
      const predictions = await modelRef.current.classify(sourceEl, topk);
      tensorLeakGuard('mobilenet.classify', baseline);
      return predictions;
    } catch (err) {
      const message = String(err?.message ?? err ?? '');
      if (/context lost|webgl/i.test(message)) {
        // Re-tag so callers (EdgeAIScanner) can show a specific, actionable
        // message rather than the generic scan-failed copy.
        const contextErr = new Error('WEBGL_CONTEXT_LOST');
        contextErr.cause = err;
        throw contextErr;
      }
      throw err;
    }
  }, []);

  return { status, backend, classify, isMountedRef };
}

export default useMobileNetModel;
