import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Geo-Farm — useGeolocation
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * AUDIT CONTEXT: the codebase had no geolocation usage prior to this pass,
 * so there was nothing to "fix" in place — instead this hook implements the
 * capability the checklist calls for (field-scan geotagging) to the safety
 * bar requested:
 *
 *   - `navigator.geolocation` is a callback API, not promise-based. We wrap
 *     it in a Promise ourselves for `getCurrentPosition()`, and critically
 *     ALWAYS provide both the success and error callbacks — an omitted
 *     error callback is the single most common cause of "unhandled
 *     rejection" bugs with this API, because the browser then has no way
 *     to signal denial/timeout back into user code at all.
 *   - Every entry point is guarded for the browser/context not supporting
 *     geolocation at all (older browsers, some in-app webviews, and any
 *     browser that disables the API entirely on insecure `http://` origins
 *     per the W3C Secure Contexts spec) — we resolve a typed error state
 *     instead of letting `navigator.geolocation` be `undefined` and throw
 *     a raw TypeError.
 *   - `watchPosition` (opt-in via `{ watch: true }`) is paired with
 *     `clearWatch` in the effect cleanup, so an unmounted component never
 *     keeps the device's GPS radio active or updates state after unmount.
 */

const ERROR_MESSAGES = {
  UNSUPPORTED: 'Geolocation is not supported in this browser.',
  INSECURE_CONTEXT: 'Location requires HTTPS (or localhost). This page is not running in a secure context.',
  PERMISSION_DENIED: 'Location permission was denied. Enable it in your browser/site settings to geotag scans.',
  POSITION_UNAVAILABLE: 'Your location could not be determined right now. Try again in the open air or with GPS enabled.',
  TIMEOUT: 'Location request timed out. Check your GPS/network signal and try again.',
  UNKNOWN: 'Unable to retrieve your location.',
};

function mapGeolocationError(err) {
  // GeolocationPositionError codes: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
  switch (err?.code) {
    case 1:
      return { code: 'PERMISSION_DENIED', message: ERROR_MESSAGES.PERMISSION_DENIED };
    case 2:
      return { code: 'POSITION_UNAVAILABLE', message: ERROR_MESSAGES.POSITION_UNAVAILABLE };
    case 3:
      return { code: 'TIMEOUT', message: ERROR_MESSAGES.TIMEOUT };
    default:
      return { code: 'UNKNOWN', message: ERROR_MESSAGES.UNKNOWN };
  }
}

function isGeolocationAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

const DEFAULT_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };

export function useGeolocation({ watch = false, options } = {}) {
  const [position, setPosition] = useState(null); // { latitude, longitude, accuracy, timestamp }
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | locating | success | error
  const watchIdRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // FIX (checklist 2.2): always clear an active watch on unmount so we
      // never keep the GPS radio running, or call setState, after the
      // component using this hook is gone.
      if (watchIdRef.current !== null && isGeolocationAvailable()) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const applySuccess = useCallback((pos) => {
    if (!isMountedRef.current) return;
    setPosition({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: pos.timestamp,
    });
    setError(null);
    setStatus('success');
  }, []);

  const applyError = useCallback((err) => {
    if (!isMountedRef.current) return;
    setError(mapGeolocationError(err));
    setStatus('error');
  }, []);

  const precheck = useCallback(() => {
    if (!isGeolocationAvailable()) {
      const unsupported = { code: 'UNSUPPORTED', message: ERROR_MESSAGES.UNSUPPORTED };
      setError(unsupported);
      setStatus('error');
      return unsupported;
    }
    // Secure Contexts spec: browsers disable geolocation on plain HTTP
    // (except localhost). Surface this distinctly rather than letting the
    // browser's own permission prompt silently never appear.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const insecure = { code: 'INSECURE_CONTEXT', message: ERROR_MESSAGES.INSECURE_CONTEXT };
      setError(insecure);
      setStatus('error');
      return insecure;
    }
    return null;
  }, []);

  /** One-shot location fetch. Never throws / never rejects unhandled —
   *  callers can `await` it and inspect the returned `{ ok, position, error }`
   *  instead of needing a try/catch. */
  const getCurrentPosition = useCallback(async () => {
    const precheckError = precheck();
    if (precheckError) return { ok: false, position: null, error: precheckError };

    setStatus('locating');
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applySuccess(pos);
          resolve({
            ok: true,
            position: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              timestamp: pos.timestamp,
            },
            error: null,
          });
        },
        (err) => {
          const mapped = mapGeolocationError(err);
          applyError(err);
          // Resolve (never reject) — this is the fix for "unhandled
          // promise rejection on denial": the caller always gets a
          // well-formed result object to branch on.
          resolve({ ok: false, position: null, error: mapped });
        },
        { ...DEFAULT_OPTIONS, ...options }
      );
    });
  }, [applyError, applySuccess, options, precheck]);

  const startWatch = useCallback(() => {
    const precheckError = precheck();
    if (precheckError) return;
    if (watchIdRef.current !== null) return; // already watching
    setStatus('locating');
    watchIdRef.current = navigator.geolocation.watchPosition(
      applySuccess,
      applyError,
      { ...DEFAULT_OPTIONS, ...options }
    );
  }, [applyError, applySuccess, options, precheck]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && isGeolocationAvailable()) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!watch) return;
    startWatch();
    return () => stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  return { position, error, status, getCurrentPosition, startWatch, stopWatch };
}

export default useGeolocation;
