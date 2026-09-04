import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ScanLine,
  Upload,
  Loader2,
  CheckCircle2,
  AlertOctagon,
  MapPin,
  LocateFixed,
  Leaf,
  FlaskConical,
  Landmark,
  Sprout,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import { Card, CardHeader } from '../ui/Card.jsx';
import { useMobileNetModel } from '../../hooks/useMobileNetModel.js';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { useAlertQueue, ALERT_SOURCE, RISK_LEVEL } from '../../contexts/AlertQueueContext.jsx';
import LeafHeatmapCanvas from './LeafHeatmapCanvas.jsx';
import {
  analyzeColorSignature,
  validateLeafPresence,
  assessImageQuality,
  computeSeverity,
  getSeverityBandInfo,
  guessCropFromLabels,
  resolveDiagnosis,
  computeStressHeatmapGrid,
  runTTAInference,
  calibrateConfidence,
  buildGeotaggedPayload,
  mapSeverityToRiskLevel,
  SEVERITY_LEVELS,
} from '../../services/aiScannerEngine.js';

/**
 * Geo-Farm — Advanced Crop Scanner
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Enterprise-grade upgrade of EdgeAIScanner.jsx's inference path. Reuses
 * this codebase's already-audited, leak-safe foundations rather than
 * re-inventing them:
 *   - useMobileNetModel() — model load/dispose lifecycle + WebGL/WASM/CPU
 *     backend fallback (utils/tfBackend.js) with context-loss recovery.
 *   - useGeolocation() — permission-safe GPS lookup for the payload's
 *     geoCoordinates field.
 *   - The same camera start/stop race-condition-safe token pattern
 *     EdgeAIScanner.jsx uses (a superseded getUserMedia() response is
 *     detected and its stream stopped immediately rather than applied).
 *
 * New in this component: the multi-stage pipeline (leaf validation -> TTA
 * classification -> severity/heatmap), image-quality gating (dark/blurry),
 * and the full diagnostic breakdown + geotagged JSON payload UI.
 *
 * TENSOR LIFECYCLE: every tensor created during a scan is created and
 * disposed inside aiScannerEngine.runTTAInference() (per-variant, in a
 * `finally` block — see that file). This component never holds a raw
 * tf.Tensor in React state; only plain JS numbers/strings/arrays cross
 * into UI state, so there is nothing here for a re-render to leak.
 */

const PIPELINE_STAGES = {
  IDLE: 'IDLE',
  CAPTURING: 'CAPTURING',
  QUALITY_CHECK: 'QUALITY_CHECK',
  VALIDATING_LEAF: 'VALIDATING_LEAF',
  CLASSIFYING: 'CLASSIFYING',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
};

const STAGE_LABELS = {
  [PIPELINE_STAGES.CAPTURING]: 'Capturing frame…',
  [PIPELINE_STAGES.QUALITY_CHECK]: 'Checking image quality…',
  [PIPELINE_STAGES.VALIDATING_LEAF]: 'Stage 1 — Validating leaf presence…',
  [PIPELINE_STAGES.CLASSIFYING]: 'Stage 2 — Running TTA classification…',
};

export default function AdvancedCropScanner({ open, onClose }) {
  const { status: modelStatus, backend, classify, isMountedRef } = useMobileNetModel();
  const geo = useGeolocation();
  const { addAlert } = useAlertQueue();

  const [mode, setMode] = useState('upload'); // 'upload' | 'camera'
  const [imageSrc, setImageSrc] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [stage, setStage] = useState(PIPELINE_STAGES.IDLE);
  const [qualityWarning, setQualityWarning] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [result, setResult] = useState(null); // { diagnosis, crop, confidence, severityLevel, affectedAreaPct, heatmapData, payload }
  const [heatmapVisible, setHeatmapVisible] = useState(true);
  const [treatmentTab, setTreatmentTab] = useState('organic'); // 'organic' | 'chemical' | 'govtAdvisory'
  const [alertSubmitted, setAlertSubmitted] = useState(false);

  const imgRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const workCanvasRef = useRef(null); // pooled 224x224 scratch canvas for TTA preprocessing
  const captureCanvasRef = useRef(null); // pooled higher-res canvas for display + heatmap grid
  const cameraRequestIdRef = useRef(0);

  if (!workCanvasRef.current && typeof document !== 'undefined') {
    workCanvasRef.current = document.createElement('canvas');
  }
  if (!captureCanvasRef.current && typeof document !== 'undefined') {
    captureCanvasRef.current = document.createElement('canvas');
  }

  // Stop the camera stream whenever the modal closes or the component
  // unmounts — mirrors EdgeAIScanner.jsx's cleanup so no hardware indicator
  // is left on after this modal is dismissed mid-camera-session.
  useEffect(() => {
    if (!open) {
      stopCamera();
      resetState();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resetState = () => {
    setImageSrc(null);
    setStage(PIPELINE_STAGES.IDLE);
    setQualityWarning(null);
    setErrorMessage(null);
    setResult(null);
    setAlertSubmitted(false);
  };

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const requestId = ++cameraRequestIdRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });

      // Race-condition guard: if the user switched away from camera mode
      // (or closed the modal) while getUserMedia() was pending, this
      // response is stale — stop it immediately rather than wire it up.
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
    cameraRequestIdRef.current += 1; // invalidate any in-flight startCamera()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
      setCameraError(null);
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Selected file is not a valid image.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!isMountedRef.current) return;
      resetState();
      setImageSrc(ev.target.result); // set after resetState() so it isn't immediately cleared
    };
    reader.onerror = () => {
      if (!isMountedRef.current) return;
      setErrorMessage('Could not read the selected file.');
    };
    reader.readAsDataURL(file);
  };

  // ---------------------------------------------------------------------
  // Multi-stage pipeline
  // ---------------------------------------------------------------------

  const runScan = useCallback(async () => {
    if (modelStatus !== 'ready') return;
    setErrorMessage(null);
    setQualityWarning(null);
    setResult(null);
    setAlertSubmitted(false);

    try {
      const sourceEl = mode === 'camera' && videoRef.current && cameraActive ? videoRef.current : imgRef.current;
      if (!sourceEl) return;

      const isReady =
        mode === 'camera'
          ? sourceEl.readyState >= 2 && sourceEl.videoWidth > 0
          : sourceEl.complete && sourceEl.naturalWidth > 0;
      if (!isReady) {
        setStage(PIPELINE_STAGES.ERROR);
        setErrorMessage('Image not fully loaded yet — please try again.');
        return;
      }

      // --- Capture: draw a shared higher-res square capture used for
      // display, quality assessment, and the heatmap grid. ---
      setStage(PIPELINE_STAGES.CAPTURING);
      const captureCanvas = captureCanvasRef.current;
      const side = Math.min(
        sourceEl.videoWidth || sourceEl.naturalWidth,
        sourceEl.videoHeight || sourceEl.naturalHeight
      );
      const sx = ((sourceEl.videoWidth || sourceEl.naturalWidth) - side) / 2;
      const sy = ((sourceEl.videoHeight || sourceEl.naturalHeight) - side) / 2;
      captureCanvas.width = 320;
      captureCanvas.height = 320;
      const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
      captureCtx.drawImage(sourceEl, sx, sy, side, side, 0, 0, 320, 320);
      const captureImageData = captureCtx.getImageData(0, 0, 320, 320);
      if (!isMountedRef.current) return;

      // --- Quality gate: reject only when BOTH too dark AND too blurry —
      // either alone is common in real field photos and shouldn't block a
      // scan outright, just warn. ---
      setStage(PIPELINE_STAGES.QUALITY_CHECK);
      const quality = assessImageQuality(captureImageData);
      if (quality.isTooDark && quality.isLikelyBlurry) {
        setStage(PIPELINE_STAGES.ERROR);
        setErrorMessage('Image is too dark and blurry to analyze reliably. Retake in better lighting, holding the camera steady.');
        return;
      }
      if (quality.isTooDark) setQualityWarning('Low-light image — results may be less reliable. Consider retaking in better light.');
      else if (quality.isLikelyBlurry) setQualityWarning('Image appears blurry — hold the camera steady for a sharper result.');

      const colorSignature = analyzeColorSignature(captureImageData);

      // --- Stage 1: Leaf validation --- (single quick classify pass, not full TTA)
      setStage(PIPELINE_STAGES.VALIDATING_LEAF);
      await frameYield();
      if (!isMountedRef.current) return;
      const quickPredictions = await classify(captureCanvas, 5);
      if (!isMountedRef.current) return;
      const leafCheck = validateLeafPresence(colorSignature, quickPredictions);
      if (!leafCheck.isValid) {
        setStage(PIPELINE_STAGES.ERROR);
        setErrorMessage(leafCheck.reason);
        return;
      }

      // --- Stage 2: TTA classification + crop guess ---
      setStage(PIPELINE_STAGES.CLASSIFYING);
      const { averaged, perVariant } = await runTTAInference(classify, sourceEl, workCanvasRef.current, 5);
      if (!isMountedRef.current) return;
      const { crop, matched: cropMatched } = guessCropFromLabels(averaged);

      // --- Stage 3: Severity + heatmap ---
      const { affectedAreaPct, severityLevel } = computeSeverity(colorSignature);
      const { bandWidth, distanceFromBandCenter } = getSeverityBandInfo(colorSignature.stressIndex);
      const heatmapData = computeStressHeatmapGrid(captureCanvas, 8);
      const diagnosis = resolveDiagnosis(crop, severityLevel);
      const confidence = calibrateConfidence({
        perVariant,
        cropMatched,
        stressIndex: colorSignature.stressIndex,
        severityBandWidth: bandWidth,
        distanceFromBandCenter,
      });

      const payload = buildGeotaggedPayload({
        crop,
        diagnosis,
        confidence,
        severityLevel,
        affectedAreaPct,
        heatmapData,
        geoPosition: geo.position,
      });

      if (!isMountedRef.current) return;
      setResult({ diagnosis, crop, confidence, severityLevel, affectedAreaPct, heatmapData, colorSignature, payload });
      setStage(PIPELINE_STAGES.COMPLETE);
    } catch (err) {
      if (!isMountedRef.current) return;
      const message =
        err?.message === 'WEBGL_CONTEXT_LOST'
          ? 'GPU context was lost mid-scan. The app has switched to a fallback backend — please try scanning again.'
          : err?.message === 'TTA_INFERENCE_FAILED'
          ? 'Analysis failed on all attempts. Check your connection (for first-time model load) and try again.'
          : 'Scan failed unexpectedly. Please try again.';
      setStage(PIPELINE_STAGES.ERROR);
      setErrorMessage(message);
    }
  }, [modelStatus, mode, cameraActive, classify, isMountedRef, geo.position]);

  const handleFlagAlert = () => {
    if (!result) return;
    addAlert({
      source: ALERT_SOURCE.EDGE_AI_SCAN,
      riskLevel: mapSeverityToRiskLevel(result.severityLevel, RISK_LEVEL),
      title: `${result.diagnosis.cropLabel} — ${result.diagnosis.commonName}`,
      description: result.diagnosis.symptoms?.join('; ') ?? '',
      confidence: result.confidence,
      metadata: {
        affectedAreaPct: result.affectedAreaPct,
        stressIndex: result.colorSignature.stressIndex,
        ...(geo.position
          ? { latitude: geo.position.latitude, longitude: geo.position.longitude, gpsAccuracy: geo.position.accuracy }
          : {}),
      },
    });
    setAlertSubmitted(true);
  };

  const isBusy = stage !== PIPELINE_STAGES.IDLE && stage !== PIPELINE_STAGES.COMPLETE && stage !== PIPELINE_STAGES.ERROR;
  const canScan = modelStatus === 'ready' && !isBusy && ((mode === 'upload' && imageSrc) || (mode === 'camera' && cameraActive));

  return (
    <Modal open={open} onClose={onClose} title="Advanced Crop Scanner" size="xl">
      <Card padded={false} className="p-4 sm:p-5">
        <CardHeader
          icon={ScanLine}
          title="Multi-Stage AI Diagnostic Scanner"
          subtitle="Leaf validation → TTA classification → severity indexing, fully client-side"
          action={
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setMode('upload')}
                className={`px-3 py-1.5 font-medium transition-colors ${mode === 'upload' ? 'bg-farm-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                Upload
              </button>
              <button
                onClick={() => setMode('camera')}
                className={`px-3 py-1.5 font-medium transition-colors ${mode === 'camera' ? 'bg-farm-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                Live Camera
              </button>
            </div>
          }
        />

        {modelStatus === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading diagnostic model…
          </div>
        )}
        {modelStatus === 'error' && (
          <div className="flex items-center gap-2 text-sm text-risk-severe py-8 justify-center">
            <AlertOctagon size={16} /> Could not load the diagnostic model. Check your connection and reopen the scanner.
          </div>
        )}

        {modelStatus === 'ready' && (
          <>
            {backend && backend !== 'webgl' && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertOctagon size={12} className="shrink-0" />
                Running in reduced-performance mode ({backend.toUpperCase()} backend) — GPU acceleration unavailable
                on this device/session. Scans will still complete, just slower.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* --- Capture / preview pane --- */}
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-black/40 aspect-square relative">
                {mode === 'upload' ? (
                  imageSrc ? (
                    <img ref={imgRef} src={imageSrc} alt="Uploaded crop sample" className="w-full h-full object-cover" crossOrigin="anonymous" />
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <Upload size={28} />
                      <span className="text-sm">Upload a leaf photo</span>
                    </button>
                  )
                ) : cameraError ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-4 text-risk-severe">
                    <AlertOctagon size={24} />
                    <span className="text-xs leading-relaxed">{cameraError}</span>
                    <button onClick={startCamera} className="mt-1 text-xs font-semibold text-farm-400 hover:text-farm-300 underline">
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="relative w-full h-full">
                    <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
                    {/* Guided viewfinder overlay — static, no canvas needed */}
                    {cameraActive && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-3/5 h-3/5 border-2 border-dashed border-farm-400/80 rounded-2xl flex items-end justify-center pb-2">
                          <span className="text-[11px] font-medium text-farm-300 bg-black/50 px-2 py-0.5 rounded">
                            Align leaf within frame
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Heatmap overlay renders on top of the completed capture */}
                {stage === PIPELINE_STAGES.COMPLETE && result?.heatmapData?.grid && (
                  <LeafHeatmapCanvas
                    grid={result.heatmapData.grid}
                    boundingBox={result.heatmapData.boundingBox}
                    visible={heatmapVisible}
                  />
                )}

                {isBusy && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                    <Loader2 size={22} className="animate-spin text-farm-400" />
                    <span className="text-xs text-farm-300 font-medium">{STAGE_LABELS[stage]}</span>
                  </div>
                )}

                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </div>

              {/* --- Controls + diagnostic breakdown pane --- */}
              <div className="flex flex-col">
                {mode === 'upload' && imageSrc && (
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs text-slate-400 hover:text-slate-200 mb-2 self-start">
                    Change image
                  </button>
                )}

                <button
                  onClick={runScan}
                  disabled={!canScan}
                  className="w-full py-3 rounded-lg bg-farm-600 hover:bg-farm-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-glow"
                >
                  {isBusy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <ScanLine size={16} /> Run Diagnostic Scan
                    </>
                  )}
                </button>

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
                  {geo.position ? `Tagged: ${geo.position.latitude.toFixed(4)}, ${geo.position.longitude.toFixed(4)}` : 'Tag GPS location (optional)'}
                </button>
                {geo.error && <p className="text-[11px] text-amber-400 mt-1">{geo.error.message}</p>}

                {qualityWarning && (
                  <p className="text-[11px] text-amber-400 mt-2 flex items-center gap-1">
                    <AlertOctagon size={11} className="shrink-0" /> {qualityWarning}
                  </p>
                )}

                {errorMessage && (
                  <p className="text-xs text-risk-severe mt-3 flex items-center gap-1.5">
                    <AlertOctagon size={13} className="shrink-0" /> {errorMessage}
                  </p>
                )}

                {result && stage === PIPELINE_STAGES.COMPLETE && (
                  <DiagnosticBreakdown
                    result={result}
                    heatmapVisible={heatmapVisible}
                    onToggleHeatmap={() => setHeatmapVisible((v) => !v)}
                    treatmentTab={treatmentTab}
                    onTreatmentTab={setTreatmentTab}
                    alertSubmitted={alertSubmitted}
                    onFlag={handleFlagAlert}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </Modal>
  );
}

/** Yields one animation frame so a stage transition actually paints before
 *  the next (synchronous, CPU-heavy) pipeline step begins. */
function frameYield() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// ============================================================================
// Diagnostic Breakdown Panel
// ============================================================================

const CONFIDENCE_TIERS = [
  { min: 0.75, label: 'High reliability', color: 'text-farm-400', bar: 'bg-farm-500' },
  { min: 0.5, label: 'Moderate reliability', color: 'text-amber-400', bar: 'bg-amber-500' },
  { min: 0, label: 'Low reliability — verify manually', color: 'text-risk-severe', bar: 'bg-risk-severe' },
];

const SEVERITY_DOT = {
  [SEVERITY_LEVELS.HEALTHY]: 'bg-farm-500',
  [SEVERITY_LEVELS.EARLY_STAGE]: 'bg-amber-400',
  [SEVERITY_LEVELS.MODERATE]: 'bg-orange-500',
  [SEVERITY_LEVELS.CRITICAL]: 'bg-risk-critical',
};

function DiagnosticBreakdown({ result, heatmapVisible, onToggleHeatmap, treatmentTab, onTreatmentTab, alertSubmitted, onFlag }) {
  const { diagnosis, crop, confidence, severityLevel, affectedAreaPct } = result;
  const tier = CONFIDENCE_TIERS.find((t) => confidence >= t.min) ?? CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1];

  return (
    <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
      {/* Primary diagnosis */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-medium">
            <Sprout size={11} /> {diagnosis.cropLabel}
            {crop === 'unspecified' && <span className="text-amber-500">(crop unresolved)</span>}
          </div>
          <p className="text-sm font-bold text-slate-100 mt-0.5 truncate">{diagnosis.commonName}</p>
          <p className="text-[11px] text-slate-500 italic truncate">{diagnosis.scientificName}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border ${
          severityLevel === SEVERITY_LEVELS.HEALTHY
            ? 'bg-farm-600/15 text-farm-400 border-farm-600/40'
            : severityLevel === SEVERITY_LEVELS.CRITICAL
            ? 'bg-risk-critical/20 text-red-300 border-risk-critical/50'
            : 'bg-amber-500/15 text-amber-400 border-amber-500/40'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[severityLevel]}`} />
          {severityLevel}
        </span>
      </div>

      {/* Confidence gauge */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-slate-400">Confidence</span>
          <span className={`font-semibold ${tier.color}`}>{Math.round(confidence * 100)}% · {tier.label}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className={`h-full ${tier.bar} transition-all`} style={{ width: `${confidence * 100}%` }} />
        </div>
      </div>

      {/* Affected area + heatmap toggle */}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>
          Affected surface area: <strong className="text-slate-200">{affectedAreaPct}%</strong>
        </span>
        <button onClick={onToggleHeatmap} className="flex items-center gap-1 text-farm-400 hover:text-farm-300 font-medium">
          {heatmapVisible ? <EyeOff size={12} /> : <Eye size={12} />} {heatmapVisible ? 'Hide' : 'Show'} heatmap
        </button>
      </div>

      {/* Symptoms & causes */}
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="text-slate-500 font-semibold uppercase tracking-wide mb-1">Symptoms</p>
          <ul className="space-y-0.5 text-slate-300">
            {diagnosis.symptoms.map((s, i) => (
              <li key={i} className="flex gap-1"><ChevronRight size={10} className="shrink-0 mt-0.5 text-slate-600" />{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-slate-500 font-semibold uppercase tracking-wide mb-1">Root Causes</p>
          <ul className="space-y-0.5 text-slate-300">
            {diagnosis.causes.map((c, i) => (
              <li key={i} className="flex gap-1"><ChevronRight size={10} className="shrink-0 mt-0.5 text-slate-600" />{c}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Treatment plan tabs */}
      <div>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-[11px] mb-2">
          {[
            { key: 'organic', label: 'Organic', icon: Leaf },
            { key: 'chemical', label: 'Chemical', icon: FlaskConical },
            { key: 'govtAdvisory', label: 'Govt Advisory', icon: Landmark },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onTreatmentTab(key)}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 font-medium transition-colors ${
                treatmentTab === key ? 'bg-farm-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-300 leading-relaxed">
          {treatmentTab === 'govtAdvisory' ? (
            <p>{diagnosis.treatment.govtAdvisory}</p>
          ) : (
            <ul className="space-y-1">
              {diagnosis.treatment[treatmentTab].map((item, i) => (
                <li key={i} className="flex gap-1"><ChevronRight size={10} className="shrink-0 mt-0.5 text-slate-600" />{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {severityLevel !== SEVERITY_LEVELS.HEALTHY && (
        <button
          onClick={onFlag}
          disabled={alertSubmitted}
          className="w-full py-2 rounded-lg border border-farm-600/50 text-farm-400 text-xs font-semibold hover:bg-farm-600/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
        >
          {alertSubmitted ? (
            <>
              <CheckCircle2 size={14} /> Flagged for officer review
            </>
          ) : (
            'Flag for officer review'
          )}
        </button>
      )}

      {/* Structured payload preview */}
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300 font-medium">View structured JSON payload</summary>
        <pre className="mt-2 p-2 rounded-lg bg-black/40 border border-slate-800 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(result.payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
