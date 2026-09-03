import React from 'react';

/**
 * Geo-Farm — Card UI Primitive
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Shared glass-panel container used by SensorTelemetryPanel, PestForecastPanel,
 * OfficerDashboard, AlertCenter, EdgeAIScanner, and GISMap for consistent
 * dark-dashboard visual language.
 */

export function Card({ children, className = '', padded = true, ...rest }) {
  return (
    <div
      className={`glass-panel rounded-xl ${padded ? 'p-4 sm:p-5' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ icon: Icon, title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start gap-3 mb-4 ${className}`}>
      {Icon && (
        <div className="w-9 h-9 rounded-lg bg-farm-600/15 border border-farm-600/30 flex items-center justify-center shrink-0">
          <Icon size={18} className="text-farm-400" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-100 truncate">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardStat({ label, value, unit, trend, className = '' }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
        {label}
      </span>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-2xl font-bold text-slate-100 tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
      {trend !== undefined && trend !== null && (
        <span
          className={`text-[11px] font-medium mt-0.5 ${
            trend > 0 ? 'text-risk-high' : trend < 0 ? 'text-farm-400' : 'text-slate-500'
          }`}
        >
          {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'} {Math.abs(trend).toFixed(1)}
        </span>
      )}
    </div>
  );
}

export default Card;
