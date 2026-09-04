import * as tf from '@tensorflow/tfjs';

/**
 * Geo-Farm — Advanced AI Scanner Engine
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * ============================================================================
 * ENGINEERING NOTE — what this file honestly does and doesn't do
 * ============================================================================
 * The model actually running client-side (`@tensorflow-models/mobilenet`,
 * loaded once by `useMobileNetModel.js`) is a general ImageNet-1000
 * classifier. It has never seen a PlantVillage disease label. There is no
 * true 38-class PlantVillage CNN shipping in this browser build — training
 * and exporting one is real, separate work (tracked as Phase 3 in the
 * architecture doc), not something that can be conjured from a frozen
 * generic classifier.
 *
 * What this engine does instead, and does honestly:
 *   1. LEAF VALIDATION (Stage 1) — combines MobileNet's own label semantics
 *      with a deterministic canvas color-composition check to reject
 *      obviously-non-plant frames (faces, walls, sky, empty background).
 *   2. CROP GUESS (part of Stage 2) — best-effort keyword match against
 *      MobileNet's top-K ImageNet labels (which DOES include some real
 *      plant/produce classes — corn, cauliflower, etc.) to *guess* a crop
 *      family. Falls back to "Unspecified crop" rather than fabricating one.
 *   3. SEVERITY/DISEASE (Stage 2 + 3) — driven by a deterministic pixel
 *      color-signature stress index (healthy-green vs. chlorotic-yellow vs.
 *      necrotic-brown coverage), the same real, reproducible signal
 *      EdgeAIScanner.jsx already uses — now computed per test-time-augmented
 *      view and per spatial grid cell (for the heatmap), and mapped through
 *      a DISEASE_DATABASE of real agronomy reference text (symptoms/causes/
 *      treatment) keyed by crop+severity band.
 *   4. CONFIDENCE is calibrated to reflect points 1-3 above — it is capped
 *      well short of 99% and explicitly penalized when the crop guess is
 *      unresolved, so the UI's "confidence gauge" never overstates certainty
 *      a frozen generic classifier + color heuristic cannot actually back.
 *
 * Swapping in a real fine-tuned PlantVillage TFJS model later is a
 * service-layer change: replace `guessCropFromLabels()` +
 * `computeSeverity()`'s role with the fine-tuned model's direct softmax
 * output, keep everything else (TTA harness, preprocessing, heatmap grid,
 * tensor lifecycle, disease database, payload shape) as-is.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Severity schema (Stage 3)
// ----------------------------------------------------------------------------

export const SEVERITY_LEVELS = Object.freeze({
  HEALTHY: 'Healthy',
  EARLY_STAGE: 'Early Stage',
  MODERATE: 'Moderate',
  CRITICAL: 'Critical',
});

/** Maps this module's SEVERITY_LEVELS to AlertQueueContext's RISK_LEVEL enum,
 *  so a flagged advanced scan can feed the same alert pipeline EdgeAIScanner
 *  already uses. Import RISK_LEVEL from the caller and pass it in — kept
 *  decoupled here so this service has no React/context dependency. */
export function mapSeverityToRiskLevel(severity, RISK_LEVEL) {
  switch (severity) {
    case SEVERITY_LEVELS.HEALTHY:
      return RISK_LEVEL.LOW;
    case SEVERITY_LEVELS.EARLY_STAGE:
      return RISK_LEVEL.MODERATE;
    case SEVERITY_LEVELS.MODERATE:
      return RISK_LEVEL.HIGH;
    case SEVERITY_LEVELS.CRITICAL:
      return RISK_LEVEL.CRITICAL;
    default:
      return RISK_LEVEL.MODERATE;
  }
}

/** Single source of truth for severity thresholds — shared by computeSeverity()
 *  and getSeverityBandInfo() so calibrateConfidence() never duplicates these
 *  magic numbers. */
const SEVERITY_BANDS = [
  { level: SEVERITY_LEVELS.HEALTHY, min: 0, max: 0.12 },
  { level: SEVERITY_LEVELS.EARLY_STAGE, min: 0.12, max: 0.35 },
  { level: SEVERITY_LEVELS.MODERATE, min: 0.35, max: 0.65 },
  { level: SEVERITY_LEVELS.CRITICAL, min: 0.65, max: 1.5 }, // open-ended in practice
];

/**
 * Computes affected-surface-area percentage and a severity bucket from a
 * color-signature reading (see analyzeColorSignature below).
 * @param {{ greenRatio: number, yellowRatio: number, brownRatio: number, stressIndex: number }} signature
 */
export function computeSeverity(signature) {
  const affectedAreaPct = Math.round(
    Math.min(1, signature.yellowRatio + signature.brownRatio) * 100
  );
  const band = SEVERITY_BANDS.find((b) => signature.stressIndex <= b.max) ?? SEVERITY_BANDS[SEVERITY_BANDS.length - 1];
  return { affectedAreaPct, severityLevel: band.level };
}

/**
 * Returns how wide the matched severity band is and how far the stress
 * index sits from that band's center — the two numbers
 * calibrateConfidence() needs to judge "decisively in-band" vs.
 * "right on a boundary" without the caller re-deriving SEVERITY_BANDS itself.
 */
export function getSeverityBandInfo(stressIndex) {
  const band = SEVERITY_BANDS.find((b) => stressIndex <= b.max) ?? SEVERITY_BANDS[SEVERITY_BANDS.length - 1];
  const bandWidth = band.max - band.min;
  const center = band.min + bandWidth / 2;
  return { bandWidth, distanceFromBandCenter: Math.abs(stressIndex - center) };
}

// ----------------------------------------------------------------------------
// Crop identification (best-effort keyword match against MobileNet labels)
// ----------------------------------------------------------------------------

const CROP_KEYWORDS = {
  tomato: ['tomato'],
  potato: ['potato'],
  corn: ['corn', 'maize', 'ear'],
  apple: ['apple', 'granny smith'],
  grape: ['grape', 'fig'],
  pepper: ['bell pepper', 'pepper'],
  cucumber: ['cucumber', 'zucchini'],
  cauliflower: ['cauliflower', 'broccoli', 'cabbage', 'head cabbage'],
  banana: ['banana'],
  cotton: ['cotton'],
};

/**
 * @param {{ className: string, probability: number }[]} predictions MobileNet's raw top-K
 * @returns {{ crop: string, matched: boolean }}
 */
export function guessCropFromLabels(predictions) {
  const joined = predictions.map((p) => p.className.toLowerCase()).join(' | ');
  for (const [crop, keywords] of Object.entries(CROP_KEYWORDS)) {
    if (keywords.some((kw) => joined.includes(kw))) {
      return { crop, matched: true };
    }
  }
  return { crop: 'unspecified', matched: false };
}

// ----------------------------------------------------------------------------
// Stage 1: Leaf validation
// ----------------------------------------------------------------------------

const NON_PLANT_LABEL_HINTS = ['person', 'face', 'wall', 'screen', 'menu', 'website', 'envelope', 'book jacket'];
const MIN_ORGANIC_COVERAGE = 0.1; // greenRatio + yellowRatio + brownRatio combined

/**
 * @param {{ greenRatio: number, yellowRatio: number, brownRatio: number }} signature
 * @param {{ className: string }[]} predictions
 * @returns {{ isValid: boolean, reason: string | null }}
 */
export function validateLeafPresence(signature, predictions) {
  const organicCoverage = signature.greenRatio + signature.yellowRatio + signature.brownRatio;
  const topLabels = predictions.map((p) => p.className.toLowerCase());

  const looksLikeNonPlant = topLabels.some((label) => NON_PLANT_LABEL_HINTS.some((hint) => label.includes(hint)));

  if (looksLikeNonPlant && organicCoverage < 0.25) {
    return { isValid: false, reason: 'This looks like a non-agricultural subject. Please frame a leaf or crop sample.' };
  }
  if (organicCoverage < MIN_ORGANIC_COVERAGE) {
    return {
      isValid: false,
      reason: 'No leaf surface detected in frame. Move closer and ensure the leaf fills most of the frame.',
    };
  }
  return { isValid: true, reason: null };
}

// ----------------------------------------------------------------------------
// Image quality guards
// ----------------------------------------------------------------------------

/**
 * Cheap luminance + gradient-magnitude sampling pass (same sparse-sampling
 * performance pattern as the color-signature analyzer below — every 16th
 * byte, not every pixel) used to flag frames too dark or too blurry to
 * trust a diagnosis from, before spending a TTA inference pass on them.
 * @param {ImageData} imageData
 */
export function assessImageQuality(imageData) {
  const { data, width } = imageData;
  let lumaSum = 0;
  let gradientSum = 0;
  let samples = 0;

  for (let i = 0; i < data.length - width * 4; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    lumaSum += luma;

    // Approximate horizontal gradient using the same-row pixel 4 samples
    // ahead (16 bytes = 4 pixels, given our stride) as a cheap blur proxy —
    // a genuinely sharp image has high average local contrast; a blurred
    // one flattens it. Not a true Laplacian, but proportionate and fast
    // enough to run on every captured frame.
    const rNext = data[i + 16] ?? r;
    gradientSum += Math.abs(r - rNext);
    samples += 1;
  }

  const avgLuma = lumaSum / Math.max(1, samples);
  const avgGradient = gradientSum / Math.max(1, samples);

  return {
    avgLuma,
    avgGradient,
    isTooDark: avgLuma < 40,
    isLikelyBlurry: avgGradient < 3,
  };
}

// ----------------------------------------------------------------------------
// Canvas preprocessing (Stage: pre-processing engine)
// ----------------------------------------------------------------------------

const TARGET_SIZE = 224;

/**
 * Aspect-ratio-preserving center crop to a square, drawn at TARGET_SIZE,
 * with a light contrast stretch applied via canvas pixel manipulation
 * (a simple linear histogram stretch — cheap, and meaningfully improves
 * MobileNet's classify() stability on washed-out or low-contrast field
 * photos versus feeding it the raw crop).
 *
 * @param {CanvasImageSource & { videoWidth?: number, naturalWidth?: number, width?: number }} sourceEl
 * @param {HTMLCanvasElement} workCanvas reusable canvas (pooled by caller — avoids per-call allocation)
 * @param {{ flip?: boolean, zoom?: number }} [variant] TTA sub-crop parameters
 * @returns {HTMLCanvasElement}
 */
export function preprocessToCanvas(sourceEl, workCanvas, variant = {}) {
  const { flip = false, zoom = 1 } = variant;

  const srcWidth = sourceEl.videoWidth || sourceEl.naturalWidth || sourceEl.width;
  const srcHeight = sourceEl.videoHeight || sourceEl.naturalHeight || sourceEl.height;
  const side = Math.min(srcWidth, srcHeight);

  // Center-crop square, then apply the TTA zoom factor by shrinking the
  // crop window further around the same center (zoom > 1 = tighter crop).
  const cropSide = side / Math.max(1, zoom);
  const sx = (srcWidth - cropSide) / 2;
  const sy = (srcHeight - cropSide) / 2;

  workCanvas.width = TARGET_SIZE;
  workCanvas.height = TARGET_SIZE;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.save();
  ctx.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);

  if (flip) {
    ctx.translate(TARGET_SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sourceEl, sx, sy, cropSide, cropSide, 0, 0, TARGET_SIZE, TARGET_SIZE);
  ctx.restore();

  applyContrastStretch(ctx, TARGET_SIZE, TARGET_SIZE);
  return workCanvas;
}

/** In-place linear contrast stretch (min-max histogram normalization) on the 2D context's current pixels. */
function applyContrastStretch(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }

  const range = Math.max(1, max - min);
  // Skip the pass entirely if the image is already well-spread — avoids
  // amplifying sensor noise on frames that don't need it.
  if (range > 200) return;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(((data[i] - min) / range) * 255);
    data[i + 1] = clampByte(((data[i + 1] - min) / range) * 255);
    data[i + 2] = clampByte(((data[i + 2] - min) / range) * 255);
  }
  ctx.putImageData(imageData, 0, 0);
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Converts a preprocessed canvas into a [1, 224, 224, 3] float tensor.
 * Wrapped in tf.tidy so every intermediate op tensor (fromPixels' output,
 * the cast, the expandDims target) is disposed automatically — ONLY the
 * tensor tf.tidy's callback returns survives, and the CALLER is responsible
 * for disposing that one after use (see runTTAInference below, which does
 * so in a finally block).
 * @param {HTMLCanvasElement} canvas
 * @returns {tf.Tensor4D}
 */
export function canvasToTensor(canvas) {
  return tf.tidy(() => {
    const pixels = tf.browser.fromPixels(canvas); // [224, 224, 3] int32
    const floatPixels = pixels.toFloat();
    return floatPixels.expandDims(0); // [1, 224, 224, 3]
  });
}

// ----------------------------------------------------------------------------
// Color-signature analysis (per-frame + per-grid-cell, for the heatmap)
// ----------------------------------------------------------------------------

/** @param {ImageData} imageData */
export function analyzeColorSignature(imageData) {
  const { data } = imageData;
  let greenPixels = 0;
  let yellowPixels = 0;
  let brownPixels = 0;
  let total = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    total += 1;
    if (g > r * 1.05 && g > b * 1.15 && g > 60) greenPixels += 1;
    else if (r > 150 && g > 130 && b < 110) yellowPixels += 1;
    else if (r > 70 && r < 160 && g < 110 && b < 90) brownPixels += 1;
  }

  const greenRatio = greenPixels / Math.max(1, total);
  const yellowRatio = yellowPixels / Math.max(1, total);
  const brownRatio = brownPixels / Math.max(1, total);
  const stressIndex = Number(
    ((yellowRatio * 1.4 + brownRatio * 2.0) / Math.max(0.05, greenRatio + yellowRatio + brownRatio)).toFixed(3)
  );

  return { greenRatio, yellowRatio, brownRatio, stressIndex };
}

/**
 * Builds an NxN grid of per-cell stress intensity (0-1) from a canvas —
 * the spatial signal LeafHeatmapCanvas.jsx renders as a hotspot overlay,
 * and the basis for the auto-computed disease bounding box.
 *
 * HONESTY NOTE: this is a lesion-density spatial proxy computed directly
 * from pixel color composition per cell — NOT a true Grad-CAM. Real
 * Grad-CAM requires gradient access to a disease-specific classifier's
 * final conv layer; MobileNet's frozen ImageNet head has no disease class
 * to compute a class-activation gradient against, so nothing built here
 * pretends otherwise. The output serves the same UX purpose (show WHERE
 * on the leaf looks affected) via a method that's real and reproducible.
 *
 * @param {HTMLCanvasElement} canvas a canvas already drawn with the leaf frame
 * @param {number} gridSize e.g. 8 for an 8x8 grid
 * @returns {{ grid: number[][], boundingBox: {x:number,y:number,w:number,h:number} | null }}
 */
export function computeStressHeatmapGrid(canvas, gridSize = 8) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const cellW = width / gridSize;
  const cellH = height / gridSize;

  const grid = [];
  let maxIntensity = 0;
  let hotCell = null;

  for (let row = 0; row < gridSize; row++) {
    const rowValues = [];
    for (let col = 0; col < gridSize; col++) {
      const cellData = ctx.getImageData(col * cellW, row * cellH, Math.max(1, cellW), Math.max(1, cellH));
      const sig = analyzeColorSignature(cellData);
      const intensity = Math.max(0, Math.min(1, sig.stressIndex));
      rowValues.push(intensity);
      if (intensity > maxIntensity) {
        maxIntensity = intensity;
        hotCell = { row, col };
      }
    }
    grid.push(rowValues);
  }

  // Bounding box = the hottest cell expanded by one neighbor in each
  // direction (a simple 3x3 hotspot cluster), normalized to 0-1 for
  // resolution-independent rendering by LeafHeatmapCanvas.
  let boundingBox = null;
  if (hotCell && maxIntensity > 0.2) {
    const r0 = Math.max(0, hotCell.row - 1);
    const c0 = Math.max(0, hotCell.col - 1);
    const r1 = Math.min(gridSize, hotCell.row + 2);
    const c1 = Math.min(gridSize, hotCell.col + 2);
    boundingBox = {
      x: c0 / gridSize,
      y: r0 / gridSize,
      w: (c1 - c0) / gridSize,
      h: (r1 - r0) / gridSize,
    };
  }

  return { grid, boundingBox };
}

// ----------------------------------------------------------------------------
// Test-Time Augmentation inference harness
// ----------------------------------------------------------------------------

const TTA_VARIANTS = [
  { name: 'original', flip: false, zoom: 1 },
  { name: 'horizontal-flip', flip: true, zoom: 1 },
  { name: 'center-zoom', flip: false, zoom: 1.15 },
];

/**
 * Runs classify() across 3 TTA sub-crops and averages per-class
 * probabilities. Every tensor created for a variant is disposed in a
 * `finally` block immediately after that variant's classify() call
 * resolves — tensors are never held across iterations or returned to
 * the caller, so a scan leaves zero net tensors regardless of how many
 * variants run or whether one throws partway through.
 *
 * @param {(source: tf.Tensor4D, topk: number) => Promise<{className:string, probability:number}[]>} classify
 *   from useMobileNetModel()
 * @param {CanvasImageSource} sourceEl
 * @param {HTMLCanvasElement} workCanvas pooled scratch canvas
 * @param {number} topK
 */
export async function runTTAInference(classify, sourceEl, workCanvas, topK = 5) {
  const perVariant = [];
  const scoreSums = new Map(); // className -> summed probability
  let variantsRun = 0;

  for (const variant of TTA_VARIANTS) {
    const preprocessed = preprocessToCanvas(sourceEl, workCanvas, variant);
    const tensor = canvasToTensor(preprocessed);
    try {
      const predictions = await classify(tensor, topK);
      perVariant.push({ variant: variant.name, predictions });
      predictions.forEach((p) => {
        scoreSums.set(p.className, (scoreSums.get(p.className) ?? 0) + p.probability);
      });
      variantsRun += 1;
    } catch (err) {
      // A single failed variant (e.g. transient WebGL hiccup) shouldn't
      // sink the whole TTA pass — log and continue averaging over
      // whichever variants did succeed.
      console.warn(`[Geo-Farm][aiScannerEngine] TTA variant "${variant.name}" failed:`, err);
    } finally {
      tensor.dispose();
    }
  }

  if (variantsRun === 0) {
    throw new Error('TTA_INFERENCE_FAILED');
  }

  const averaged = Array.from(scoreSums.entries())
    .map(([className, sum]) => ({ className, probability: sum / variantsRun }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, topK);

  return { averaged, perVariant, variantsRun };
}

// ----------------------------------------------------------------------------
// Disease knowledge base (Stage 2/3 reference text — PlantVillage-inspired
// crop scope; real per-disease CLASSIFICATION still comes from the severity
// band + crop guess above, not a dedicated disease classifier — see the
// header note).
// ----------------------------------------------------------------------------

export const DISEASE_DATABASE = {
  tomato: {
    cropLabel: 'Tomato',
    [SEVERITY_LEVELS.HEALTHY]: {
      scientificName: 'Solanum lycopersicum (no pathogen detected)',
      commonName: 'Healthy foliage',
      symptoms: ['Uniform green coloration', 'No visible lesions or wilting'],
      causes: ['N/A'],
      treatment: {
        organic: ['Continue regular monitoring', 'Maintain balanced compost feeding'],
        chemical: ['None required'],
        govtAdvisory: 'No action needed — consistent with ICAR-IIHR routine crop health guidelines.',
      },
    },
    [SEVERITY_LEVELS.EARLY_STAGE]: {
      scientificName: 'Alternaria solani (early blight, early onset)',
      commonName: 'Early Blight (early stage)',
      symptoms: ['Small dark concentric-ring spots on lower leaves', 'Slight yellowing around lesions'],
      causes: ['Warm humid conditions', 'Overhead irrigation splashing spores onto foliage'],
      treatment: {
        organic: ['Remove and destroy affected lower leaves', 'Apply neem oil spray every 7 days'],
        chemical: ['Copper oxychloride 0.3% at first sign of spread'],
        govtAdvisory: 'Consult your nearest Krishi Vigyan Kendra (KVK) for regionally approved fungicide dosage.',
      },
    },
    [SEVERITY_LEVELS.MODERATE]: {
      scientificName: 'Alternaria solani (early blight, established)',
      commonName: 'Early Blight (moderate spread)',
      symptoms: ['Concentric-ring lesions spreading up the canopy', 'Leaf yellowing and drop beginning'],
      causes: ['Prolonged leaf wetness', 'Nutrient-stressed plants (esp. nitrogen)'],
      treatment: {
        organic: ['Increase plant spacing/prune for airflow', 'Bacillus subtilis-based biofungicide'],
        chemical: ['Mancozeb 75% WP at label rate, 10-day interval'],
        govtAdvisory: 'Report spread over >20% of the field to the District Agricultural Officer for subsidy-linked treatment support.',
      },
    },
    [SEVERITY_LEVELS.CRITICAL]: {
      scientificName: 'Phytophthora infestans (late blight, advanced)',
      commonName: 'Late Blight (critical)',
      symptoms: ['Large water-soaked/blackened patches', 'Rapid canopy collapse', 'White fungal growth on leaf undersides in humidity'],
      causes: ['Cool wet weather', 'Rapid pathogen spread from infected neighboring plants'],
      treatment: {
        organic: ['Immediate removal and safe disposal of infected plants (do not compost)'],
        chemical: ['Cymoxanil + Mancozeb combination product per label — apply immediately'],
        govtAdvisory: 'CRITICAL — file an immediate outbreak report; eligible for Disaster Relief crop-loss assessment.',
      },
    },
  },
  potato: {
    cropLabel: 'Potato',
    [SEVERITY_LEVELS.HEALTHY]: {
      scientificName: 'Solanum tuberosum (no pathogen detected)',
      commonName: 'Healthy foliage',
      symptoms: ['Even green canopy'],
      causes: ['N/A'],
      treatment: { organic: ['Routine monitoring'], chemical: ['None required'], govtAdvisory: 'No action needed.' },
    },
    [SEVERITY_LEVELS.EARLY_STAGE]: {
      scientificName: 'Alternaria solani',
      commonName: 'Early Blight (early stage)',
      symptoms: ['Small brown target-like spots on older leaves'],
      causes: ['Warm humid microclimate', 'Plant stress'],
      treatment: {
        organic: ['Remove affected foliage', 'Neem-based spray'],
        chemical: ['Chlorothalonil at label rate'],
        govtAdvisory: 'Consult KVK for region-specific fungicide rotation to prevent resistance.',
      },
    },
    [SEVERITY_LEVELS.MODERATE]: {
      scientificName: 'Alternaria solani',
      commonName: 'Early Blight (moderate spread)',
      symptoms: ['Lesions coalescing, visible yellowing halo', 'Lower canopy defoliation'],
      causes: ['Continued leaf wetness', 'Delayed first treatment'],
      treatment: {
        organic: ['Improve field drainage/airflow'],
        chemical: ['Mancozeb 75% WP, 10-day interval'],
        govtAdvisory: 'Register the field for the state Pest Surveillance program if not already enrolled.',
      },
    },
    [SEVERITY_LEVELS.CRITICAL]: {
      scientificName: 'Phytophthora infestans',
      commonName: 'Late Blight (critical)',
      symptoms: ['Blackened, collapsing foliage', 'Tuber rot risk'],
      causes: ['Cool wet conditions favoring rapid spread'],
      treatment: {
        organic: ['Emergency removal of infected plants'],
        chemical: ['Cymoxanil + Mancozeb — apply without delay'],
        govtAdvisory: 'CRITICAL — eligible for immediate Disaster Relief inspection and subsidy claim.',
      },
    },
  },
  unspecified: {
    cropLabel: 'Unspecified crop',
    [SEVERITY_LEVELS.HEALTHY]: {
      scientificName: 'Not determined',
      commonName: 'No visible stress',
      symptoms: ['Predominantly healthy-green coverage'],
      causes: ['N/A'],
      treatment: { organic: ['Continue monitoring'], chemical: ['None required'], govtAdvisory: 'No action needed.' },
    },
    [SEVERITY_LEVELS.EARLY_STAGE]: {
      scientificName: 'Not determined — generic stress signature',
      commonName: 'Early foliar stress (crop unresolved)',
      symptoms: ['Mild chlorotic (yellowing) patches'],
      causes: ['Possible nutrient deficiency, early pathogen activity, or water stress'],
      treatment: {
        organic: ['Inspect for pests/nutrient signs before treating'],
        chemical: ['Hold — identify crop and specific cause first'],
        govtAdvisory: 'Upload a clearer, closer image or consult your local KVK for on-site identification.',
      },
    },
    [SEVERITY_LEVELS.MODERATE]: {
      scientificName: 'Not determined — generic stress signature',
      commonName: 'Moderate foliar stress (crop unresolved)',
      symptoms: ['Visible yellow/brown patches across a meaningful leaf area'],
      causes: ['Likely fungal/bacterial pathogen or advancing nutrient deficiency'],
      treatment: {
        organic: ['Isolate affected plants from healthy stock where practical'],
        chemical: ['Consult an agronomist before applying broad-spectrum fungicide blind'],
        govtAdvisory: 'Request a field visit from the District Agricultural Officer for accurate identification.',
      },
    },
    [SEVERITY_LEVELS.CRITICAL]: {
      scientificName: 'Not determined — generic stress signature',
      commonName: 'Critical foliar stress (crop unresolved)',
      symptoms: ['Extensive necrotic/browning coverage', 'Likely canopy collapse in progress'],
      causes: ['Advanced pathogen activity or severe abiotic stress'],
      treatment: {
        organic: ['Remove severely affected material to slow spread'],
        chemical: ['Urgent in-person diagnosis needed before chemical selection'],
        govtAdvisory: 'CRITICAL — flag for immediate officer review regardless of crop identification status.',
      },
    },
  },
};

/**
 * Resolves the best-matching disease-database entry for a crop guess +
 * severity band, falling back to the generic 'unspecified' crop entry
 * (never throws on an unrecognized crop key).
 */
export function resolveDiagnosis(crop, severityLevel) {
  const cropEntry = DISEASE_DATABASE[crop] ?? DISEASE_DATABASE.unspecified;
  const entry = cropEntry[severityLevel] ?? DISEASE_DATABASE.unspecified[severityLevel];
  return { cropLabel: cropEntry.cropLabel, ...entry };
}

// ----------------------------------------------------------------------------
// Confidence calibration
// ----------------------------------------------------------------------------

/**
 * Blends (a) how much the averaged TTA predictions agree with each other
 * (low variance across the 3 variants = more trustworthy), (b) whether a
 * crop was actually resolved, and (c) how decisively the stress index
 * falls inside its severity band rather than sitting right on a boundary.
 * Deliberately capped below 100% — this method cannot support certainty
 * beyond that.
 *
 * AUDIT FIX (Low — dead parameter): `stressIndex` was destructured here but
 * never referenced in the function body (confirmed by ESLint's
 * `no-unused-vars`). Every call site (AdvancedCropScanner.jsx) still passes
 * it, which is harmless, but leaving it in the signature falsely implies
 * the raw stress index independently influences confidence beyond what
 * `distanceFromBandCenter` (which is itself derived from stressIndex)
 * already captures. Removed rather than silently "used" with a fake
 * calculation, since inventing a second, undocumented scoring term would be
 * a worse fix than acknowledging `distanceFromBandCenter` is the intended
 * proxy for it.
 */
export function calibrateConfidence({ perVariant, cropMatched, severityBandWidth, distanceFromBandCenter }) {
  // Agreement: how consistent the TOP label was across the 3 TTA variants.
  const topLabels = perVariant.map((v) => v.predictions?.[0]?.className).filter(Boolean);
  const uniqueTop = new Set(topLabels).size;
  const agreementScore = topLabels.length === 0 ? 0.4 : 1 - (uniqueTop - 1) / Math.max(1, topLabels.length);

  const cropScore = cropMatched ? 0.85 : 0.45;

  const bandCertainty =
    severityBandWidth > 0
      ? Math.max(0, Math.min(1, 1 - distanceFromBandCenter / (severityBandWidth / 2)))
      : 0.6;

  const blended = agreementScore * 0.4 + cropScore * 0.25 + bandCertainty * 0.35;
  return Number(Math.min(0.94, Math.max(0.28, blended)).toFixed(2));
}

// ----------------------------------------------------------------------------
// Structured output payload (spec: { crop, disease, confidence, severity, heatmapData, geoCoordinates, timestamp })
// ----------------------------------------------------------------------------

export function buildGeotaggedPayload({ crop, diagnosis, confidence, severityLevel, affectedAreaPct, heatmapData, geoPosition }) {
  return {
    crop: crop === 'unspecified' ? null : crop,
    disease: {
      scientificName: diagnosis.scientificName,
      commonName: diagnosis.commonName,
    },
    confidence,
    severity: {
      level: severityLevel,
      affectedAreaPct,
    },
    heatmapData: {
      grid: heatmapData.grid,
      boundingBox: heatmapData.boundingBox,
    },
    geoCoordinates: geoPosition
      ? { lat: geoPosition.latitude, lng: geoPosition.longitude, accuracy: geoPosition.accuracy }
      : null,
    timestamp: Date.now(),
  };
}
