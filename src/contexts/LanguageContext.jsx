import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * Geo-Farm — Language Context
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Provides a global English / Marathi toggle plus a translation lookup
 * used across AlertCenter, OfficerDashboard, EdgeAIScanner advisories, etc.
 */

const STORAGE_KEY = 'geofarm_lang';

export const LANGUAGES = {
  en: { code: 'en', label: 'English', nativeLabel: 'English' },
  mr: { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
};

// Central translation dictionary. Components can extend this by importing
// TRANSLATIONS directly, or by calling t('key') from the context.
export const TRANSLATIONS = {
  en: {
    appName: 'Geo-Farm',
    tagline: 'Early Crop Disease & Pest Intelligence',
    dashboard: 'Dashboard',
    telemetry: 'Sensor Telemetry',
    pestForecast: 'Pest Forecast',
    gisMap: 'Satellite & GIS Map',
    scanner: 'Edge-AI Leaf Scanner',
    officerDashboard: 'Officer Dashboard',
    alertCenter: 'Alert Center',
    riskLow: 'Low Risk',
    riskModerate: 'Moderate Risk',
    riskHigh: 'High Risk',
    riskSevere: 'Severe Risk',
    riskCritical: 'Critical Risk',
    statusPending: 'Pending',
    statusVerified: 'Verified',
    statusDispatched: 'Alert Dispatched',
    statusFlagged: 'AI Flagged',
    statusAudited: 'Officer Audited',
    statusAll: 'All',
    temperature: 'Temperature',
    humidity: 'Relative Humidity',
    leafWetness: 'Leaf Wetness Duration',
    infectionRisk: 'Infection Risk',
    degreeDays: 'Degree-Day Accumulation',
    trapCount: 'Trap Count',
    uploadImage: 'Upload Leaf Image',
    useCamera: 'Use Live Camera',
    scanning: 'Scanning...',
    confidence: 'Confidence',
    advisory: 'Advisory',
    verify: 'Verify',
    dispatch: 'Dispatch Alert',
    reject: 'Reject',
    language: 'Language',
    liveData: 'Live',

    // Sensor Telemetry Panel
    sharedNodeRadius: 'km shared-node radius',
    farmsServed: 'farms served',
    minWetnessRequired: 'Min. wetness required',

    // Pest Forecast Panel
    swarmImminentBanner:
      'Swarm emergence imminent — trap activity and degree-day accumulation both elevated',
    emergenceRisk: 'Emergence Risk',
    sevenNightAvg: '7-Night Avg',
    daysToEmergence: 'days to projected emergence',
    insufficientTrend: 'Insufficient trend data for projection',
    percentOfThreshold: 'of threshold',
    activeSwarmWatch: 'Active Swarm Watch',
    trapsExceeding: 'trap(s) exceeding economic threshold',
    nightlyCatchUnit: '/night',
    threshUnit: 'thresh.',

    // GIS Map
    gisSubtitle: 'Nashik & Rahuri belts · simulated NDVI canopy stress · shared-node coverage',
    ndviStress: 'NDVI Stress',
    sensorRadius: 'Sensor Radius',
    pestTraps: 'Pest Traps',
    simulatedNdviNote: 'Simulated NDVI raster (not live satellite feed)',
    sensorNodesCount: 'sensor nodes',
    trapsCountLabel: 'traps',
    swarmImminentTag: 'Swarm Imminent',
    monitoringTag: 'Monitoring',
    farmsLabel: 'farms',
    radiusLabel: 'radius',
    catchPerNight: 'catch/night',
    toEmergence: 'to emergence',

    // Edge-AI Scanner
    scannerSubtitle: 'Offline-capable on-device inference — no image ever leaves the browser',
    loadingModel: 'Loading MobileNet weights...',
    modelLoadError: 'Failed to load AI model. Check your connection and reload.',
    changeImage: 'Change image',
    runScan: 'Run Edge-AI Scan',
    flagForReview: 'Flag for Officer Verification',
    flaggedForReview: 'Flagged for Officer Review',
    scanFailed: 'Scan failed — please try again with a clearer leaf image.',
    stressIndex: 'Stress index',
    healthyLabel: 'Healthy Canopy',
    healthyAdvisory: 'Continue routine monitoring. No intervention needed at this time.',
    nutrientLabel: 'Nutrient Deficiency (Chlorosis)',
    nutrientAdvisory:
      'Yellowing pattern suggests nitrogen/magnesium deficiency. Apply balanced foliar feed and re-scan in 5-7 days.',
    powderyScanLabel: 'Powdery Mildew (Suspected)',
    powderyScanAdvisory:
      'Powdery white coating consistent with Erysiphe necator. Apply sulfur-based fungicide; improve canopy airflow via pruning.',
    rustLabel: 'Leaf Rust / Necrotic Lesions',
    rustAdvisory:
      'Brown pustule pattern consistent with rust infection. Isolate affected rows, apply triazole fungicide, remove severely infected leaves.',
    blightLabel: 'Bacterial Blight (Advanced)',
    blightAdvisory:
      'Extensive necrosis detected — high probability of bacterial blight spread. Escalate to agriculture officer immediately; consider copper-based bactericide and quarantine of affected block.',

    // Officer Dashboard
    officerSubtitle: 'AI-flagged outbreaks await verification before farmer broadcast',
    noAlertsQueue: 'No alerts in this queue right now.',
    noAlertsHint: 'Run a scan in the Edge-AI Scanner to generate a flagged alert.',
    reviewingOfficer: 'Reviewing Officer',
    fieldNote: 'Field Note (optional)',
    fieldNotePlaceholder: 'e.g. Confirmed via site visit, block 4B...',
    aiConfidence: 'AI confidence',
    flaggedTimeAgo: 'Flagged',
    sourceTelemetry: 'Sensor Telemetry',
    sourcePestForecast: 'Pest Forecast',
    sourceEdgeAiScan: 'Edge-AI Scan',

    // Alert Center
    alertCenterSubtitle: 'Dispatched alerts rendered as WhatsApp, SMS & IVR payloads for farmer reach',
    noDispatched: 'No alerts dispatched yet.',
    noDispatchedHint: 'Verify and dispatch an alert from the Officer Dashboard to see it here.',
    dispatchedVia: 'Dispatched via',
    whatsappDesc: 'Simulated WhatsApp Business API template payload',
    smsDesc: 'Plain-text SMS',
    ivrDesc: 'Text-to-speech script for automated voice call (feature phones)',
    officerVerifiedTag: 'Officer verified',
    alertPayloadPreview: 'Alert Payload Preview',
    segments: 'segment(s)',
    chars: 'chars',
  },
  mr: {
    appName: 'जिओ-फार्म',
    tagline: 'पीक रोग व कीड लवकर ओळख प्रणाली',
    dashboard: 'डॅशबोर्ड',
    telemetry: 'सेन्सर टेलीमेट्री',
    pestForecast: 'कीड अंदाज',
    gisMap: 'उपग्रह व जीआयएस नकाशा',
    scanner: 'एज-एआय पान स्कॅनर',
    officerDashboard: 'अधिकारी डॅशबोर्ड',
    alertCenter: 'सूचना केंद्र',
    riskLow: 'कमी धोका',
    riskModerate: 'मध्यम धोका',
    riskHigh: 'उच्च धोका',
    riskSevere: 'गंभीर धोका',
    riskCritical: 'अत्यंत गंभीर धोका',
    statusPending: 'प्रलंबित',
    statusVerified: 'पडताळणी झाली',
    statusDispatched: 'सूचना पाठवली',
    statusFlagged: 'एआय द्वारे चिन्हांकित',
    statusAudited: 'अधिकाऱ्याने तपासले',
    temperature: 'तापमान',
    humidity: 'सापेक्ष आर्द्रता',
    leafWetness: 'पान ओलावा कालावधी',
    infectionRisk: 'संसर्ग धोका',
    degreeDays: 'डिग्री-डे संचय',
    trapCount: 'सापळा संख्या',
    uploadImage: 'पानाचा फोटो अपलोड करा',
    useCamera: 'थेट कॅमेरा वापरा',
    scanning: 'तपासणी सुरू आहे...',
    confidence: 'विश्वासार्हता',
    advisory: 'सल्ला',
    verify: 'पडताळणी करा',
    dispatch: 'सूचना पाठवा',
    reject: 'नाकारा',
    language: 'भाषा',
    liveData: 'थेट',
    statusAll: 'सर्व',

    // Sensor Telemetry Panel
    sharedNodeRadius: 'किमी सामायिक-नोड त्रिज्या',
    farmsServed: 'शेतांना सेवा',
    minWetnessRequired: 'किमान आवश्यक ओलावा',

    // Pest Forecast Panel
    swarmImminentBanner: 'कीड उद्रेक जवळ आला आहे — सापळा हालचाल आणि डिग्री-डे संचय दोन्ही वाढले आहेत',
    emergenceRisk: 'उद्भव धोका',
    sevenNightAvg: '7-रात्री सरासरी',
    daysToEmergence: 'दिवसांत अंदाजित उद्भव',
    insufficientTrend: 'अंदाजासाठी अपुरा कल डेटा',
    percentOfThreshold: 'मर्यादेपैकी',
    activeSwarmWatch: 'सक्रिय कीड निरीक्षण',
    trapsExceeding: 'सापळे आर्थिक मर्यादेपेक्षा जास्त',
    nightlyCatchUnit: '/रात्र',
    threshUnit: 'मर्यादा',

    // GIS Map
    gisSubtitle: 'नाशिक व राहुरी पट्टे · अनुरूपित NDVI छत्र ताण · सामायिक-नोड व्याप्ती',
    ndviStress: 'NDVI ताण',
    sensorRadius: 'सेन्सर त्रिज्या',
    pestTraps: 'कीड सापळे',
    simulatedNdviNote: 'अनुरूपित NDVI राष्टर (थेट उपग्रह फीड नाही)',
    sensorNodesCount: 'सेन्सर नोड',
    trapsCountLabel: 'सापळे',
    swarmImminentTag: 'उद्रेक जवळ',
    monitoringTag: 'निरीक्षणाधीन',
    farmsLabel: 'शेते',
    radiusLabel: 'त्रिज्या',
    catchPerNight: 'पकड/रात्र',
    toEmergence: 'उद्भवापर्यंत',

    // Edge-AI Scanner
    scannerSubtitle: 'ऑफलाइन-सक्षम ऑन-डिव्हाइस विश्लेषण — फोटो कधीही ब्राउझर सोडत नाही',
    loadingModel: 'मॉडेल लोड होत आहे...',
    modelLoadError: 'एआय मॉडेल लोड करण्यात अयशस्वी. कनेक्शन तपासा व पुन्हा लोड करा.',
    changeImage: 'फोटो बदला',
    runScan: 'एज-एआय तपासणी सुरू करा',
    flagForReview: 'अधिकारी पडताळणीसाठी चिन्हांकित करा',
    flaggedForReview: 'अधिकारी पुनरावलोकनासाठी चिन्हांकित',
    scanFailed: 'तपासणी अयशस्वी — कृपया स्पष्ट पानाच्या फोटोसह पुन्हा प्रयत्न करा.',
    stressIndex: 'ताण निर्देशांक',
    healthyLabel: 'निरोगी छत्र',
    healthyAdvisory: 'नियमित निरीक्षण सुरू ठेवा. सध्या कोणत्याही उपाययोजनेची आवश्यकता नाही.',
    nutrientLabel: 'पोषक तत्वांची कमतरता (पिवळेपणा)',
    nutrientAdvisory:
      'पिवळेपणाचा नमुना नायट्रोजन/मॅग्नेशियम कमतरता दर्शवतो. संतुलित पर्णीय खत द्या व 5-7 दिवसांत पुन्हा तपासा.',
    powderyScanLabel: 'भुरी रोग (संशयित)',
    powderyScanAdvisory:
      'पांढरा पावडरीसारखा थर भुरी रोगाशी सुसंगत आहे. सल्फरयुक्त बुरशीनाशक वापरा; छाटणीद्वारे हवा खेळती ठेवा.',
    rustLabel: 'पान गंज / मृत ऊती डाग',
    rustAdvisory:
      'तपकिरी डाग गंज संसर्गाशी सुसंगत आहेत. बाधित ओळी वेगळ्या करा, ट्रायझोल बुरशीनाशक वापरा, गंभीर बाधित पाने काढा.',
    blightLabel: 'जिवाणू करपा (प्रगत)',
    blightAdvisory:
      'व्यापक ऊती मृत्यू आढळला — जिवाणू करपा पसरण्याची उच्च शक्यता. त्वरित कृषी अधिकाऱ्याकडे कळवा; तांबेयुक्त जीवाणूनाशक व बाधित भाग विलग करण्याचा विचार करा.',

    // Officer Dashboard
    officerSubtitle: 'शेतकऱ्यांना सूचना पाठवण्यापूर्वी एआय-चिन्हांकित उद्रेकांची पडताळणी प्रलंबित',
    noAlertsQueue: 'सध्या या यादीत कोणत्याही सूचना नाहीत.',
    noAlertsHint: 'चिन्हांकित सूचना तयार करण्यासाठी एज-एआय स्कॅनरमध्ये तपासणी करा.',
    reviewingOfficer: 'पडताळणी करणारे अधिकारी',
    fieldNote: 'क्षेत्रीय टीप (ऐच्छिक)',
    fieldNotePlaceholder: 'उदा. प्रत्यक्ष भेटीद्वारे पुष्टी, विभाग 4B...',
    aiConfidence: 'एआय विश्वासार्हता',
    flaggedTimeAgo: 'चिन्हांकित',
    sourceTelemetry: 'सेन्सर टेलीमेट्री',
    sourcePestForecast: 'कीड अंदाज',
    sourceEdgeAiScan: 'एज-एआय तपासणी',

    // Alert Center
    alertCenterSubtitle: 'पाठवलेल्या सूचना WhatsApp, SMS व IVR स्वरूपात शेतकऱ्यांपर्यंत पोहोचवण्यासाठी',
    noDispatched: 'अद्याप कोणतीही सूचना पाठवली नाही.',
    noDispatchedHint: 'येथे पाहण्यासाठी अधिकारी डॅशबोर्डवरून सूचना पडताळून पाठवा.',
    dispatchedVia: 'द्वारे पाठवले',
    whatsappDesc: 'अनुरूपित WhatsApp बिझनेस एपीआय टेम्पलेट पेलोड',
    smsDesc: 'साधा मजकूर SMS',
    ivrDesc: 'स्वयंचलित व्हॉइस कॉलसाठी मजकूर-ते-भाषण स्क्रिप्ट (फीचर फोनसाठी)',
    officerVerifiedTag: 'अधिकारी पडताळणीकृत',
    alertPayloadPreview: 'सूचना पेलोड पूर्वावलोकन',
    segments: 'भाग',
    chars: 'अक्षरे',
  },
};

const LanguageContext = createContext(undefined);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && TRANSLATIONS[stored]) return stored;
    } catch (err) {
      // localStorage unavailable (e.g. private browsing) — fall back silently
    }
    return 'en';
  });

  const setLanguage = useCallback((lang) => {
    if (!TRANSLATIONS[lang]) return;
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      // ignore persistence failures
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'mr' : 'en');
  }, [language, setLanguage]);

  const t = useCallback(
    (key) => {
      const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
      return dict[key] ?? TRANSLATIONS.en[key] ?? key;
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t,
      isMarathi: language === 'mr',
      availableLanguages: LANGUAGES,
    }),
    [language, setLanguage, toggleLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

export default LanguageContext;
