import React, { useState, useMemo } from 'react';
import {
  MessageSquareWarning,
  MessageCircle,
  Smartphone,
  PhoneCall,
  Copy,
  Check,
  Send,
} from 'lucide-react';
import { Card, CardHeader } from './ui/Card.jsx';
import { RiskBadge, Badge } from './ui/Badge.jsx';
import { SegmentToggle } from './ui/Toggle.jsx';
import { Modal } from './ui/Modal.jsx';
import { useLanguage, TRANSLATIONS } from '../contexts/LanguageContext.jsx';
import { useAlertQueue } from '../contexts/AlertQueueContext.jsx';

/**
 * Geo-Farm — Vernacular Alert & Multi-Modal Engine
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Renders every officer-dispatched alert as three simulated delivery
 * payloads for non-smartphone-inclusive reach:
 *   - WhatsApp Business API JSON payload (template message)
 *   - Plain-text SMS payload (160-char budget aware)
 *   - IVR voice-call script (for feature-phone farmers via automated call)
 *
 * Every payload is generated bilingually (English / Marathi) from the same
 * alert data, matching the officer-verified severity and advisory text.
 */

const RISK_HINDI_SEVERITY_WORD = {
  LOW: { en: 'Low', mr: 'कमी' },
  MODERATE: { en: 'Moderate', mr: 'मध्यम' },
  HIGH: { en: 'High', mr: 'उच्च' },
  SEVERE: { en: 'Severe', mr: 'गंभीर' },
  CRITICAL: { en: 'Critical', mr: 'अत्यंत गंभीर' },
};

function buildWhatsAppPayload(alert, lang) {
  const severityWord = RISK_HINDI_SEVERITY_WORD[alert.riskLevel]?.[lang] ?? alert.riskLevel;
  const bodyEn = `Geo-Farm Alert: ${alert.title}\nSeverity: ${severityWord}\n\n${alert.description}\n\nVerified by: ${alert.verifiedBy ?? 'Agriculture Officer'}`;
  const bodyMr = `जिओ-फार्म सूचना: ${alert.title}\nतीव्रता: ${severityWord}\n\n${alert.description}\n\nपडताळणी: ${alert.verifiedBy ?? 'कृषी अधिकारी'}`;

  return {
    messaging_product: 'whatsapp',
    to: '+91XXXXXXXXXX',
    type: 'template',
    template: {
      name: 'geofarm_outbreak_alert',
      language: { code: lang === 'mr' ? 'mr' : 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: lang === 'mr' ? bodyMr : bodyEn },
          ],
        },
      ],
    },
  };
}

function buildSmsPayload(alert, lang) {
  const severityWord = RISK_HINDI_SEVERITY_WORD[alert.riskLevel]?.[lang] ?? alert.riskLevel;
  const text =
    lang === 'mr'
      ? `जिओ-फार्म: ${alert.title} (${severityWord}). सल्ला: ${alert.description}`.slice(0, 300)
      : `Geo-Farm: ${alert.title} (${severityWord}). Advisory: ${alert.description}`.slice(0, 300);
  return { to: '+91XXXXXXXXXX', text, length: text.length, segments: Math.ceil(text.length / 160) };
}

function buildIvrScript(alert, lang) {
  const severityWord = RISK_HINDI_SEVERITY_WORD[alert.riskLevel]?.[lang] ?? alert.riskLevel;
  if (lang === 'mr') {
    return [
      `नमस्कार शेतकरी बंधू. ही जिओ-फार्म कडून एक महत्त्वाची सूचना आहे.`,
      `तुमच्या भागात ${alert.title} आढळले आहे. तीव्रता पातळी: ${severityWord}.`,
      `सल्ला: ${alert.description}`,
      `अधिक माहितीसाठी आपल्या जवळच्या कृषी अधिकाऱ्याशी संपर्क साधा. धन्यवाद.`,
    ].join(' ');
  }
  return [
    `Hello farmer. This is an important alert from Geo-Farm.`,
    `${alert.title} has been detected in your area. Severity level: ${severityWord}.`,
    `Advisory: ${alert.description}`,
    `Please contact your nearest agriculture officer for further guidance. Thank you.`,
  ].join(' ');
}

export default function AlertCenter() {
  const { t, language, isMarathi } = useLanguage();
  const { dispatchedAlerts } = useAlertQueue();

  const [previewAlert, setPreviewAlert] = useState(null);
  const [previewLang, setPreviewLang] = useState(language);
  const [channel, setChannel] = useState('whatsapp'); // whatsapp | sms | ivr
  const [copied, setCopied] = useState(false);

  const openPreview = (alert) => {
    setPreviewAlert(alert);
    setPreviewLang(language);
    setChannel('whatsapp');
    setCopied(false);
  };

  const payload = useMemo(() => {
    if (!previewAlert) return null;
    if (channel === 'whatsapp') return buildWhatsAppPayload(previewAlert, previewLang);
    if (channel === 'sms') return buildSmsPayload(previewAlert, previewLang);
    return { script: buildIvrScript(previewAlert, previewLang) };
  }, [previewAlert, previewLang, channel]);

  const payloadText = useMemo(() => {
    if (!payload) return '';
    if (channel === 'ivr') return payload.script;
    return JSON.stringify(payload, null, 2);
  }, [payload, channel]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payloadText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // clipboard unavailable — silently ignore in demo environment
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={MessageSquareWarning}
          title={t('alertCenter')}
          subtitle={t('alertCenterSubtitle')}
        />

        {dispatchedAlerts.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-slate-500">
            <Send size={28} />
            <p className="text-sm">{t('noDispatched')}</p>
            <p className="text-xs text-slate-600">{t('noDispatchedHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dispatchedAlerts.map((alert) => (
              <button
                key={alert.id}
                onClick={() => openPreview(alert)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/40 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-farm-600/15 border border-farm-600/30 flex items-center justify-center shrink-0">
                  <Send size={16} className="text-farm-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium text-slate-200 truncate ${isMarathi ? 'font-devanagari' : ''}`}>
                    {alert.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('dispatchedVia')} {alert.dispatchChannels?.join(', ') ?? 'whatsapp, sms'}
                  </p>
                </div>
                <RiskBadge level={alert.riskLevel} size="sm" />
              </button>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!previewAlert}
        onClose={() => setPreviewAlert(null)}
        title={previewAlert?.title ?? t('alertPayloadPreview')}
        size="lg"
      >
        {previewAlert && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentToggle
                size="sm"
                value={channel}
                onChange={setChannel}
                options={[
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'sms', label: 'SMS' },
                  { value: 'ivr', label: 'IVR Script' },
                ]}
              />
              <SegmentToggle
                size="sm"
                value={previewLang}
                onChange={setPreviewLang}
                options={[
                  { value: 'en', label: 'EN' },
                  { value: 'mr', label: 'मराठी' },
                ]}
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              {channel === 'whatsapp' && <MessageCircle size={14} />}
              {channel === 'sms' && <Smartphone size={14} />}
              {channel === 'ivr' && <PhoneCall size={14} />}
              {channel === 'whatsapp' && t('whatsappDesc')}
              {channel === 'sms' && `${t('smsDesc')} · ${payload?.segments ?? 1} ${t('segments')}, ${payload?.length ?? 0} ${t('chars')}`}
              {channel === 'ivr' && t('ivrDesc')}
            </div>

            <div className="relative">
              <pre
                className={`bg-surface-950 border border-slate-800 rounded-lg p-4 text-xs overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap ${
                  channel === 'ivr' && previewLang === 'mr' ? 'font-devanagari' : 'text-slate-300'
                } ${channel === 'ivr' ? 'text-slate-300 leading-relaxed' : 'text-emerald-300'}`}
              >
                {payloadText}
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                aria-label="Copy payload"
              >
                {copied ? <Check size={14} className="text-farm-400" /> : <Copy size={14} />}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Badge color="green" size="sm">
                {t('officerVerifiedTag')}
              </Badge>
              {previewAlert.dispatchChannels?.map((ch) => (
                <Badge key={ch} color="blue" size="sm">
                  {ch.toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
