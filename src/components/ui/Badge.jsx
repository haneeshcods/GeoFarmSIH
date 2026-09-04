import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

/**
 * Geo-Farm — Badge UI Primitive
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Renders a colored pill for either:
 *   - risk severity: LOW | MODERATE | HIGH | SEVERE | CRITICAL
 *   - workflow status: FLAGGED | VERIFIED | REJECTED | DISPATCHED
 * plus a generic freeform variant for anything else (crop tags, channel tags).
 */

const RISK_STYLES = {
  LOW: 'bg-risk-low/15 text-risk-low border-risk-low/40',
  MODERATE: 'bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40',
  HIGH: 'bg-risk-high/15 text-risk-high border-risk-high/40',
  SEVERE: 'bg-risk-severe/15 text-risk-severe border-risk-severe/40',
  CRITICAL: 'bg-risk-critical/25 text-red-300 border-risk-critical/60',
};

const RISK_LABEL_KEY = {
  LOW: 'riskLow',
  MODERATE: 'riskModerate',
  HIGH: 'riskHigh',
  SEVERE: 'riskSevere',
  CRITICAL: 'riskCritical',
};

const STATUS_STYLES = {
  FLAGGED: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  VERIFIED: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
  REJECTED: 'bg-slate-500/15 text-slate-400 border-slate-500/40',
  DISPATCHED: 'bg-farm-500/15 text-farm-400 border-farm-500/40',
};

const STATUS_LABEL_KEY = {
  FLAGGED: 'statusFlagged',
  PENDING: 'statusPending',
  VERIFIED: 'statusVerified',
  REJECTED: 'reject',
  DISPATCHED: 'statusDispatched',
};

export function RiskBadge({ level = 'LOW', size = 'md', pulse = false, className = '' }) {
  const { t } = useLanguage();
  const style = RISK_STYLES[level] ?? RISK_STYLES.LOW;
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wide ${style} ${sizeClass} ${className}`}
    >
      {pulse && (level === 'SEVERE' || level === 'CRITICAL') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {t(RISK_LABEL_KEY[level] ?? 'riskLow')}
    </span>
  );
}

export function StatusBadge({ status = 'PENDING', size = 'md', className = '' }) {
  const { t } = useLanguage();
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wide ${style} ${sizeClass} ${className}`}
    >
      {t(STATUS_LABEL_KEY[status] ?? 'statusPending')}
    </span>
  );
}

export function Badge({ children, color = 'slate', size = 'md', className = '' }) {
  const colorMap = {
    slate: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    green: 'bg-farm-500/15 text-farm-400 border-farm-500/40',
    blue: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/40',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  };
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${
        colorMap[color] ?? colorMap.slate
      } ${sizeClass} ${className}`}
    >
      {children}
    </span>
  );
}

export default Badge;
