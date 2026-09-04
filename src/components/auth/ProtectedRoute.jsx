import React from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';

/**
 * Geo-Farm — ProtectedRoute
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * AUDIT FINDING FIXED: role-gating previously lived ONLY at the sidebar's
 * affordance layer (App.jsx filtered which nav buttons were rendered for a
 * given role) — the panel-switch `renderPanel()` itself did not re-check
 * role before rendering an officer-only or student-only component. Since
 * this app has no URL router today, that specific vector isn't reachable
 * yet, but it is exactly the kind of gap that turns into a real leak the
 * moment a deep-link, browser-restored `activePanel`, or a future
 * react-router integration is added. `ProtectedRoute` re-validates on every
 * render instead of trusting that the caller only reaches this branch
 * through "safe" UI:
 *
 *   - No session / logged out            -> fallback (never renders children)
 *   - Session present but expired        -> fallback + treated as logged out
 *   - Session present but wrong role     -> fallback (protected UI never
 *                                            mounts, not even briefly)
 *   - Session valid & role matches       -> renders children
 */
export default function ProtectedRoute({ allow, children, fallback = null }) {
  const { isAuthenticated, role, isSessionExpired } = useAuth();

  if (!isAuthenticated || isSessionExpired) {
    return (
      fallback ?? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <ShieldAlert size={28} className="text-risk-severe" />
          <p className="text-sm font-semibold text-slate-200">Access restricted</p>
          <p className="text-xs text-slate-500 max-w-xs">
            Your session has ended. Please sign in again to continue.
          </p>
        </div>
      )
    );
  }

  if (Array.isArray(allow) && !allow.includes(role)) {
    return (
      fallback ?? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <ShieldAlert size={28} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-200">This section isn&rsquo;t available for your portal</p>
          <p className="text-xs text-slate-500 max-w-xs">
            You&rsquo;re signed in as a {role}. Switch to the dashboard for your role from the sidebar.
          </p>
        </div>
      )
    );
  }

  return children;
}

/** Small loading-state twin used while an async auth check (e.g. restoring
 *  and re-validating a persisted session) is still in flight, so protected
 *  UI never flashes into view before the check completes. */
export function AuthLoadingFallback({ label = 'Verifying session…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}
