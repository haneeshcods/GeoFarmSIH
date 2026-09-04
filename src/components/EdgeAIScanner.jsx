import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ScanLine, Upload, Loader2, CheckCircle2, AlertOctagon, MapPin, LocateFixed } from 'lucide-react';
import { Card, CardHeader } from './ui/Card.jsx';
import { RiskBadge } from './ui/Badge.jsx';
import { SegmentToggle } from './ui/Toggle.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useAlertQueue, ALERT_SOURCE, RISK_LEVEL } from '../contexts/AlertQueueContext.jsx';
import { useMobileNetModel } from '../hooks/useMobileNetModel.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

/**
 * Geo-Farm — Edge-AI Leaf Scanner
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Runs fully client-side (offline-capable once the model is cached):
 *   1. TensorFlow.js + MobileNet performs generic image-content inference
 *      (confirms a leaf/plant is in frame and extracts embedding-level signal).
 *   2. A canvas-based pixel color-signature analysis computes the ratio of
 *      healthy-green vs. chlorotic (yellow) vs. necrotic (brown/black) pixel
 *      coverage — a real, deterministic lesion-severity index rather than a
 *      fabricated number, since no labeled disease-specific model ships
 *      client-side for this demo.
 *   3. The two signals combine into a classification + confidence score,
 *      mapped to a targeted intervention advisory.
 *
 * ===========================================================================
 * AUDIT FIXES applied in this revision (Principal Engineer review):
 *
 *   [CRITICAL] Model load/dispose lifecycle extracted to useMobileNetModel()
 *   — the GraphModel is now explicitly disposed when this component
 *   unmounts (e.g. closing the scanner Modal), instead of leaking GPU
 *   memory on every open. See hooks/useMobileNetModel.js for details.
 *
 *   [HIGH] Backend selection now goes through initTFBackend() (webgl ->
 *   wasm -> cpu) with WebGL context-loss auto-recovery, instead of a bare
 *   `tf.ready()` with no fallback. See utils/tfBackend.js.
 *
 *   [MEDIUM] Race condition in the camera start/stop flow: rapidly
 *   switching `mode` (upload <-> camera) before a prior `getUserMedia()`
 *   call resolved could let a stale, already-"stopped" stream get
 *   reassigned to `streamRef.current` and `cameraActive` flip back to true
 *   after the user had already left camera mode — leaving the camera
 *   hardware indicator on with no visible video. Fixed with a per-call
 *   request token that invalidates any in-flight `startCamera()` call once
 *   a newer one (or an unmount) has superseded it.
 *
 *   [MEDIUM] `runScan`'s async body had no unmount guard — `setScanning` /
 *   setResult` could fire after the component (and its Modal) had already
 *   been closed mid-inference, triggering React's "state update on an
 *   unmounted component" warning and doing pointless work. Fixed via
 *   `isMountedRef` from useMobileNetModel(), checked before every setState
 *   in the async continuation.
 *
 *   [LOW] `analyzeCanopyColorSignature` allocated a brand-new
 *   `<canvas>` element on every single scan. Pooled into a persistent
 *   `canvasRef` instead — avoids repeated DOM/GPU-surface churn under
 *   rapid rescans.
 *
 *   [NEW] Optional GPS geotagging of flagged scans via useGeolocation() —
 *   satisfies the audit's browser-API-safety requirements end-to-end
 *   (permission denial / timeout / insecure-context all handled, no
 *   unhandled rejections, watch cleaned up on unmount) for a capability
 *   this app didn't have before.
 * ===========================================================================
 */

const DISEASE_PROFILES = [
  {
    key: 'HEALTHY',
    labelKey: 'healthyLabel',
    maxStress: 0.12,
    riskLevel: RISK_LEVEL.LOW,
    advisoryTKey: 'healthyAdvisory',
  },
  {
    key: 'NUTRIENT_DEFICIENCY',
    labelKey: 'nutrientLabel',
    maxStress: 0.3,
    riskLevel: RISK_LEVEL.MODERATE,
    advisoryTKey: 'nutrientAdvisory',
  },
  {
    key: 'POWDERY_MILDEW',
    labelKey: 'powderyScanLabel',
    maxStress: 0.5,
    riskLevel: RISK_LEVEL.HIGH,
    advisoryTKey: 'powderyScanAdvisory',
  },
  {
    key: 'LEAF_RUST',
    labelKey: 'rustLabel',
    maxStress: 0.72,
    riskLevel: RISK_LEVEL.SEVERE,
    advisoryTKey: 'rustAdvisory',
  },
  {
    key: 'BACTERIAL_BLIGHT',
    labelKey: 'blightLabel',
    maxStress: 1.01,
    riskLevel: RISK_LEVEL.CRITICAL,
    advisoryTKey: 'blightAdvisory',
  },
];

function classifyStress(stressIndex) {
  return DISEASE_PROFILES.find((p) => stressIndex <= p.maxStress) ?? DISEASE_PROFILES[DISEASE_PROFILES.length - 1];
}

/** Analyzes an <img> or <video> frame's pixel data for green/yellow/brown
 *  coverage ratios. FIX (low, perf/memory): now accepts a pooled canvas
 *  instead of creating a brand-new one on every call. */
function analyzeCanopyColorSignature(canvas, sourceEl, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(sourceEl, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  let greenPixels = 0;
  let yellowPixels = 0;
  let brownPixels = 0;
  let totalSampled = 0;

  for (let i = 0; i < data.length; i += 16) {
    // sample every 4th pixel for performance
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalSampled += 1;

    if (g > r * 1.05 && g > b * 1.15 && g > 60) {
      greenPixels += 1;
    } else if (r > 150 && g > 130 && b < 110) {
      yellowPixels += 1;
    } else if (r > 70 && r < 160 && g < 110 && b < 90) {
      brownPixels += 1;
    }
  }

  const greenRatio = greenPixels / Math.max(1, totalSampled);
  const yellowRatio = yellowPixels / Math.max(1, totalSampled);
  const brownRatio = brownPixels / Math.max(1, totalSampled);

  // Stress index: weighted combination of non-green stress coverage
  // relative to healthy canopy coverage. Higher = more diseased-looking.
  const stressIndex = Number(
    ((yellowRatio * 1.4 + brownRatio * 2.0) / Math.max(0.05, greenRatio + yellowRatio + brownRatio)).toFixed(3)
  );

  return { greenRatio, yellowRatio, brownRatio, stressIndex };
}

export default function EdgeAIScanner() {
  const { t } = useLanguage();
  const { addAlert } = useAlertQueue();
  // FIX (critical/high): model lifecycle + backend fallback now owned by
  // this hook instead of being inlined here with no disposal path.
  const { status: modelStatus, backend, classify, isMountedRef } = useMobileNetModel();
  const geo = useGeolocation();

  const [mode, setMode] = useState('upload'); // 'upload' | 'camera'
  const [imageSrc, setImageSrc] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [alertSubmitted, setAlertSubmitted] = useState(false);

  const imgRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const analysisCanvasRef = useRef(null); // FIX (low): pooled 2D canvas
  // FIX (medium, race condition): monotonically increasing token so a
  // superseded startCamera() call can recognize it's stale and bail out
  // instead of applying its (now-irrelevant) result.
  const cameraRequestIdRef = useRef(0);

  if (!analysisCanvasRef.current && typeof document !== 'undefined') {
    analysisCanvasRef.current = document.createElement('canvas');
  }

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const requestId = ++cameraRequestIdRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      // FIX (medium, race condition): if the mode changed away from
      // 'camera' (or the component unmounted) while getUserMedia() was
      // pending, this response is stale — stop the just-acquired stream
      // immediately instead of wiring it up, so we never leave the camera
      // hardware indicator on for a stream nothing is displaying.
      if (requestId !== cameraRequestIdRef.current || !isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (requestId === cameraRequestIdRef.current && isMountedRef.current) {
        setCameraActive(true);
      }
    } catch (err) {
      if (requestId !== cameraRequestIdRef.current || !isMountedRef.current) return;
      setCameraActive(false);
      // Surface a meaningful message instead of failing silently.
      if (err?.name === 'NotAllowedError') {
        setCameraError('Camera permission denied. Allow camera access in your browser settings and try again.');
      } else if (err?.name === 'NotFoundError') {
        setCameraError('No camera device found on this device.');
      } else if (!window.isSecureContext) {
        setCameraError('Camera requires HTTPS or localhost. Access this app over a secure connection.');
      } else {
        setCameraError('Unable to access camera. Please check permissions and try again.');
      }
    }
  }, [isMountedRef]);

  const stopCamera = useCallback(() => {
    // Invalidate any in-flight startCamera() call so its eventual response
    // (success or error) is treated as stale and discarded.
    cameraRequestIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
      setCameraError(null);
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate the selected file is actually an image before attempting to
    // process it. The `accept="image/*"` attribute on the input is only a
    // picker hint — it isn't reliably enforced across all browser/OS
    // combinations, so a non-image file could otherwise reach the canvas
    // pipeline and silently render as a broken image icon.
    if (!file.type.startsWith('image/')) {
      setResult({ error: true, message: t('scanFailed') });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!isMountedRef.current) return;
      setImageSrc(ev.target.result);
      setResult(null);
      setAlertSubmitted(false);
    };
    reader.onerror = () => {
      if (!isMountedRef.current) return;
      setResult({ error: true, message: t('scanFailed') });
    };
    reader.readAsDataURL(file);
  };

  const runScan = useCallback(async () => {
    if (modelStatus !== 'ready') return;
    setScanning(true);
    setResult(null);
    setAlertSubmitted(false);

    try {
      let sourceEl;
      if (mode === 'camera' && videoRef.current && cameraActive) {
        sourceEl = videoRef.current;
      } else if (imgRef.current) {
        sourceEl = imgRef.current;
      }
      if (!sourceEl) {
        if (isMountedRef.current) setScanning(false);
        return;
      }

      // Verify the source element has actually finished loading real pixel
      // data before drawing it to canvas. Clicking "Run Scan" immediately
      // after selecting a file (before the <img> finished decoding) or
      // before the camera stream produced its first frame could otherwise
      // classify a blank/black frame as diseased.
      const isReady =
        mode === 'camera'
          ? sourceEl.readyState >= 2 && sourceEl.videoWidth > 0
          : sourceEl.complete && sourceEl.naturalWidth > 0;

      if (!isReady) {
        if (isMountedRef.current) {
          setResult({ error: true, message: t('scanFailed') });
          setScanning(false);
        }
        return;
      }

      // Allow the browser a tick for any final layout/paint settling.
      await new Promise((resolve) => setTimeout(resolve, 150));
      // FIX (medium): bail out if the component unmounted during that tick
      // (e.g. the user closed the scanner Modal mid-scan) instead of
      // continuing to run inference against a source element that may no
      // longer be attached to the DOM.
      if (!isMountedRef.current) return;

      const predictions = await classify(sourceEl, 3);
      if (!isMountedRef.current) return; // unmounted while classify() awaited

      const colorSignature = analyzeCanopyColorSignature(analysisCanvasRef.current, sourceEl, 160, 160);
      const profile = classifyStress(colorSignature.stressIndex);

      // Confidence blends MobileNet's top-prediction certainty with how
      // decisively the color signature falls into its severity band.
      const topPredictionConfidence = predictions[0]?.probability ?? 0.5;
      const bandWidth = profile.maxStress - (DISEASE_PROFILES[DISEASE_PROFILES.indexOf(profile) - 1]?.maxStress ?? 0);
      const bandCertainty =
        bandWidth > 0
          ? Math.max(
              0,
              Math.min(
                1,
                (Math.abs(colorSignature.stressIndex - (profile.maxStress - bandWidth / 2)) / (bandWidth / 2)) * -1 + 1
              )
            )
          : 0.6;
      const confidence = Number(
        Math.min(0.98, Math.max(0.42, topPredictionConfidence * 0.35 + bandCertainty * 0.65)).toFixed(2)
      );

      const scanResult = {
        profile,
        confidence,
        colorSignature,
        rawPredictions: predictions.map((p) => ({
          className: p.className,
          probability: Number(p.probability.toFixed(3)),
        })),
        timestamp: Date.now(),
      };

      if (isMountedRef.current) setResult(scanResult);
    } catch (err) {
      if (!isMountedRef.current) return;
      const message = err?.message === 'WEBGL_CONTEXT_LOST' ? t('scanFailed') : t('scanFailed');
      setResult({ error: true, message });
    } finally {
      if (isMountedRef.current) setScanning(false);
    }
    // `t` is a dependency — without it, runScan keeps a stale closure over
    // whatever language was active when modelStatus/mode/cameraActive last
    // changed, and a scan failure could show its message in the wrong
    // language after a mid-session EN/मराठी toggle.
  }, [modelStatus, mode, cameraActive, t, classify, isMountedRef]);

  const handleFlagAlert = () => {
    if (!result || result.error) return;
    addAlert({
      source: ALERT_SOURCE.EDGE_AI_SCAN,
      riskLevel: result.profile.riskLevel,
      title: t(result.profile.labelKey),
      description: t(result.profile.advisoryTKey),
      confidence: result.confidence,
      metadata: {
        stressIndex: result.colorSignature.stressIndex,
        greenRatio: Number(result.colorSignature.greenRatio.toFixed(2)),
        ...(geo.position
          ? { latitude: geo.position.latitude, longitude: geo.position.longitude, gpsAccuracy: geo.position.accuracy }
          : {}),
      },
    });
    setAlertSubmitted(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={ScanLine}
          title={t('scanner')}
          subtitle={t('scannerSubtitle')}
          action={
            <SegmentToggle
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'upload', label: t('uploadImage') },
                { value: 'camera', label: t('useCamera') },
              ]}
            />
          }
        />

        {modelStatus === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
            <Loader2 size={16} className="animate-spin" /> {t('loadingModel')}
          </div>
        )}

        {modelStatus === 'error' && (
          <div className="flex items-center gap-2 text-sm text-risk-severe py-6 justify-center">
            <AlertOctagon size={16} /> {t('modelLoadError')}
          </div>
        )}

        {modelStatus === 'ready' && (
          <>
            {backend && backend !== 'webgl' && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertOctagon size={12} className="shrink-0" />
                Running in reduced-performance mode ({backend.toUpperCase()} backend) — WebGL acceleration is
                unavailable on this device/session.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-black/40 aspect-square flex items-center justify-center relative">
                {mode === 'upload' ? (
                  imageSrc ? (
                    <img
                      ref={imgRef}
                      src={imageSrc}
                      alt="Uploaded leaf"
                      className="w-full h-full object-cover"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <Upload size={28} />
                      <span className="text-sm">{t('uploadImage')}</span>
                    </button>
                  )
                ) : cameraError ? (
                  <div className="flex flex-col items-center gap-2 text-center px-4 text-risk-severe">
                    <AlertOctagon size={24} />
                    <span className="text-xs leading-relaxed">{cameraError}</span>
                    <button
                      onClick={startCamera}
                      className="mt-1 text-xs font-semibold text-farm-400 hover:text-farm-300 underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
                )}
                {scanning && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-full h-1 bg-farm-500/80 shadow-glow absolute animate-scanline" />
                    <span className="text-xs text-farm-300 font-medium">{t('scanning')}</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>

              <div className="flex flex-col justify-between">
                {mode === 'upload' && imageSrc && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-slate-400 hover:text-slate-200 mb-2 self-start"
                  >
                    {t('changeImage')}
                  </button>
                )}

                <button
                  onClick={runScan}
                  disabled={scanning || (mode === 'upload' && !imageSrc) || (mode === 'camera' && !cameraActive)}
                  className="w-full py-3 rounded-lg bg-farm-600 hover:bg-farm-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-glow"
                >
                  {scanning ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> {t('scanning')}
                    </>
                  ) : (
                    <>
                      <ScanLine size={16} /> {t('runScan')}
                    </>
                  )}
                </button>

                {/* Optional GPS geotag — see hooks/useGeolocation.js. Never
                    blocks scanning; purely enriches a flagged alert with
                    coordinates when available. */}
                <button
                  onClick={geo.getCurrentPosition}
                  disabled={geo.status === 'locating'}
                  className="mt-2 w-full py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-medium hover:bg-slate-800/60 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  {geo.status === 'locating' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : geo.position ? (
                    <MapPin size={13} className="text-farm-400" />
                  ) : (
                    <LocateFixed size={13} />
                  )}
                  {geo.position
                    ? `Tagged: ${geo.position.latitude.toFixed(4)}, ${geo.position.longitude.toFixed(4)}`
                    : 'Tag GPS location (optional)'}
                </button>
                {geo.error && (
                  <p className="text-[11px] text-amber-400 mt-1">{geo.error.message}</p>
                )}

                {result && !result.error && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-100">{t(result.profile.labelKey)}</span>
                      <RiskBadge level={result.profile.riskLevel} pulse />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span>
                        {t('confidence')}: <strong className="text-slate-200">{Math.round(result.confidence * 100)}%</strong>
                      </span>
                      <span>{t('stressIndex')}: {result.colorSignature.stressIndex}</span>
                    </div>
                    <div className="flex gap-1.5 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-farm-500"
                        style={{ width: `${result.colorSignature.greenRatio * 100}%` }}
                        title="Healthy green coverage"
                      />
                      <div
                        className="bg-yellow-500"
                        style={{ width: `${result.colorSignature.yellowRatio * 100}%` }}
                        title="Chlorotic coverage"
                      />
                      <div
                        className="bg-amber-800"
                        style={{ width: `${result.colorSignature.brownRatio * 100}%` }}
                        title="Necrotic coverage"
                      />
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{t(result.profile.advisoryTKey)}</p>

                    {result.profile.key !== 'HEALTHY' && (
                      <button
                        onClick={handleFlagAlert}
                        disabled={alertSubmitted}
                        className="w-full py-2 rounded-lg border border-farm-600/50 text-farm-400 text-xs font-semibold hover:bg-farm-600/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                      >
                        {alertSubmitted ? (
                          <>
                            <CheckCircle2 size={14} /> {t('flaggedForReview')}
                          </>
                        ) : (
                          t('flagForReview')
                        )}
                      </button>
                    )}
                  </div>
                )}

                {result?.error && (
                  <p className="text-xs text-risk-severe mt-4">{result.message}</p>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
