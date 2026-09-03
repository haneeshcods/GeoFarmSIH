import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

/**
 * Geo-Farm — Modal UI Primitive
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Reusable overlay dialog used by:
 *   - OfficerDashboard.jsx  (alert verification detail + note entry)
 *   - AlertCenter.jsx       (WhatsApp/SMS/IVR payload preview)
 *   - EdgeAIScanner.jsx     (full-size scan result + advisory)
 */

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size] ?? 'max-w-lg';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${sizeClass} glass-panel bg-surface-900/95 rounded-2xl shadow-2xl border border-slate-700/60 max-h-[90vh] flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg p-1.5 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
