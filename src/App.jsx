import React, { useState, Suspense, lazy } from 'react';
import {
  LayoutDashboard,
  Radio,
  Bug,
  Map as MapIcon,
  ScanLine,
  ShieldCheck,
  MessageSquareWarning,
  Leaf,
  X,
} from 'lucide-react';
import { useLanguage } from './contexts/LanguageContext.jsx';
import { useAlertQueue } from './contexts/AlertQueueContext.jsx';
import { useAutoAlertMonitor } from './hooks/useAutoAlertMonitor.js';
import { useAuth, ROLES } from './contexts/AuthContext.jsx';

import AuthGateway from './components/auth/AuthGateway.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import GovHeader from './components/layout/GovHeader.jsx';
import OfficerPortalDashboard from './components/dashboards/OfficerPortalDashboard.jsx';
import StudentPortalDashboard from './components/dashboards/StudentPortalDashboard.jsx';

import SensorTelemetryPanel from './components/SensorTelemetryPanel.jsx';
import PestForecastPanel from './components/PestForecastPanel.jsx';
import OfficerDashboard from './components/OfficerDashboard.jsx';
import AlertCenter from './components/AlertCenter.jsx';

// AUDIT FIX (Medium — eager bundle bloat): GISMap.jsx pulls in Leaflet +
// leaflet.heat + (transitively, via its own import) Land3DTerrainView.jsx's
// Three.js scene, and EdgeAIScanner.jsx pulls in @tensorflow/tfjs +
// @tensorflow-models/mobilenet. Combined these are several MB of vendor
// code (confirmed in `vite build` output: tfjs alone is ~1.9MB, three.js
// ~475KB, leaflet ~160KB gzip). Both were previously *static* imports here,
// so every session — officer or student, whether or not they ever open the
// map or scanner — downloaded and parsed all of it before the first
// dashboard paint. `React.lazy()` defers the network fetch until the panel
// is actually selected. NOTE: EdgeAIScanner is also imported from
// StudentPortalDashboard.jsx (its "Launch AI Crop Scanner" modal) — that
// import must ALSO be converted to `lazy()` (see that file), because a
// static import anywhere in the graph forces eager loading regardless of
// how many other call sites use a dynamic import() of the same module.
const GISMap = lazy(() => import('./components/GISMap.jsx'));
const EdgeAIScanner = lazy(() => import('./components/EdgeAIScanner.jsx'));

/** Lightweight, dependency-free fallback shown while a lazy panel's chunk
 *  is downloading — deliberately has no icon/library dependency of its own
 *  so it can render instantly regardless of which chunk is still in flight. */
function PanelLoading() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-slate-500">
      <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-farm-500 animate-spin mr-2" />
      Loading…
    </div>
  );
}

// Each nav item is tagged with the roles that can see it, so the sidebar
// renders a distinct navigation set per portal.
const NAV_ITEMS = [
  { key: 'overview', labelKey: 'dashboard', icon: LayoutDashboard, roles: [ROLES.OFFICER, ROLES.STUDENT] },
  { key: 'scanner', labelKey: 'scanner', icon: ScanLine, roles: [ROLES.STUDENT] },
  { key: 'telemetry', labelKey: 'telemetry', icon: Radio, roles: [ROLES.OFFICER, ROLES.STUDENT] },
  { key: 'pestForecast', labelKey: 'pestForecast', icon: Bug, roles: [ROLES.OFFICER, ROLES.STUDENT] },
  { key: 'gisMap', labelKey: 'gisMap', icon: MapIcon, roles: [ROLES.OFFICER, ROLES.STUDENT] },
  { key: 'officerDashboard', labelKey: 'officerDashboard', icon: ShieldCheck, roles: [ROLES.OFFICER] },
  { key: 'alertCenter', labelKey: 'alertCenter', icon: MessageSquareWarning, roles: [ROLES.OFFICER] },
];

function Console() {
  const [activePanel, setActivePanel] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t, isMarathi } = useLanguage();
  const { pendingAlerts } = useAlertQueue();
  const { role, isOfficer } = useAuth();
  useAutoAlertMonitor(); // real-time threshold watcher — auto-raises officer alerts

  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  // AUDIT FIX (auth 4.2 — role-gated routes): previously `renderPanel()`
  // rendered officer-only / student-only components purely because the
  // sidebar happened not to expose a button for them to the other role.
  // There was no re-check at the render layer itself, so any future path
  // that can set `activePanel` other than a sidebar click (a restored
  // value, a deep link, a router migration) would have rendered protected
  // UI to the wrong role with no guard at all. Every role-restricted panel
  // is now wrapped in <ProtectedRoute allow={[...]}> so the check happens
  // right where the UI is mounted, not just where the button lives.
  const renderPanel = () => {
    switch (activePanel) {
      case 'telemetry':
        return <SensorTelemetryPanel />;
      case 'pestForecast':
        return <PestForecastPanel />;
      case 'gisMap':
        return (
          <Suspense fallback={<PanelLoading />}>
            <GISMap />
          </Suspense>
        );
      case 'scanner':
        return (
          <ProtectedRoute allow={[ROLES.STUDENT]}>
            <Suspense fallback={<PanelLoading />}>
              <EdgeAIScanner />
            </Suspense>
          </ProtectedRoute>
        );
      case 'officerDashboard':
        return (
          <ProtectedRoute allow={[ROLES.OFFICER]}>
            <OfficerDashboard />
          </ProtectedRoute>
        );
      case 'alertCenter':
        return (
          <ProtectedRoute allow={[ROLES.OFFICER]}>
            <AlertCenter />
          </ProtectedRoute>
        );
      case 'overview':
      default:
        return isOfficer ? <OfficerPortalDashboard /> : <StudentPortalDashboard />;
    }
  };

  const accentBorder = isOfficer ? 'border-nic-700/60' : 'border-slate-800';

  return (
    <div className="min-h-screen flex bg-surface-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-40 top-0 left-0 h-full w-64 shrink-0 border-r ${accentBorder} bg-surface-900/95 backdrop-blur-md transform transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className={`flex items-center gap-2 px-5 h-16 border-b ${accentBorder}`}>
          <div className="w-8 h-8 rounded-lg bg-farm-600 flex items-center justify-center shadow-glow">
            <Leaf size={18} className="text-white" />
          </div>
          <div className="leading-tight">
            <p className={`font-bold text-slate-100 ${isMarathi ? 'font-devanagari' : ''}`}>
              {t('appName')}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              {isOfficer ? 'Officer Console' : 'Student Console'}
            </p>
          </div>
          <button
            className="ml-auto lg:hidden text-slate-400"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map(({ key, labelKey, icon: Icon }) => {
            const isActive = activePanel === key;
            const showBadge = key === 'officerDashboard' && pendingAlerts.length > 0;
            return (
              <button
                key={key}
                onClick={() => {
                  setActivePanel(key);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? isOfficer
                      ? 'bg-nic-600/30 text-saffron-400 border border-saffron-500/40'
                      : 'bg-farm-600/20 text-farm-400 border border-farm-600/40'
                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                } ${isMarathi ? 'font-devanagari' : ''}`}
              >
                <Icon size={18} />
                <span className="flex-1 text-left">
                  {key === 'overview' ? (isOfficer ? 'Command Dashboard' : 'My Dashboard') : t(labelKey)}
                </span>
                {showBadge && (
                  <span className="text-[10px] font-bold bg-risk-severe text-white rounded-full px-1.5 py-0.5">
                    {pendingAlerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <GovHeader onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">{renderPanel()}</main>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <AuthGateway />;
  return <Console />;
}
