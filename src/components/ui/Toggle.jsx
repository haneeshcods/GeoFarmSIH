import React from 'react';

/**
 * Geo-Farm — Toggle UI Primitive
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Reusable switch used for:
 *   - Language toggle (English / Marathi) in AlertCenter
 *   - Camera vs. Upload mode switch in EdgeAIScanner
 *   - Any other boolean setting across the dashboard
 */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
}) {
  const trackSize = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const knobSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5';
  const translateX = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label
      className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        className={`relative inline-flex ${trackSize} shrink-0 items-center rounded-full transition-colors duration-200 border ${
          checked
            ? 'bg-farm-600 border-farm-500'
            : 'bg-slate-700 border-slate-600'
        }`}
      >
        <span
          className={`inline-block ${knobSize} transform rounded-full bg-white shadow-md transition-transform duration-200 ${
            checked ? translateX : 'translate-x-0.5'
          }`}
        />
      </button>

      {(label || description) && (
        <span className="flex flex-col">
          {label && <span className="text-sm font-medium text-slate-200">{label}</span>}
          {description && <span className="text-xs text-slate-400">{description}</span>}
        </span>
      )}
    </label>
  );
}

/**
 * SegmentToggle — two-option pill switch (e.g. "EN | MR", "Upload | Camera").
 * Alternative to the boolean Toggle above when both states need visible labels.
 */
export function SegmentToggle({ options, value, onChange, size = 'md' }) {
  const padClass = size === 'sm' ? 'text-xs px-2.5 py-1' : 'text-sm px-3.5 py-1.5';

  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-surface-900/60 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange?.(opt.value)}
          className={`rounded-md font-medium transition-colors ${padClass} ${
            value === opt.value
              ? 'bg-farm-600 text-white shadow-glow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default Toggle;
