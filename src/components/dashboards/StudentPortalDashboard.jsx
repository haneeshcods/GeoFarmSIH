import React, { useMemo, useState, Suspense, lazy } from 'react';
import {
  ScanLine,
  Sprout,
  Trophy,
  MapPinned,
  FlaskConical,
  GraduationCap,
  ClipboardList,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardHeader, CardStat } from '../ui/Card.jsx';
import { RiskBadge, StatusBadge } from '../ui/Badge.jsx';
import { Modal } from '../ui/Modal.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAlertQueue, ALERT_SOURCE } from '../../contexts/AlertQueueContext.jsx';

// AUDIT FIX (Medium — eager bundle bloat, see App.jsx for the fuller note):
// both scanners pull in @tensorflow/tfjs + @tensorflow-models/mobilenet.
// This was the SECOND static-import site for EdgeAIScanner (the first was
// App.jsx's sidebar 'scanner' panel) — converting only one site would not
// have deferred anything, since a single static importer anywhere still
// forces eager loading of the whole module graph. Both are now lazy.
const EdgeAIScanner = lazy(() => import('../EdgeAIScanner.jsx'));
const AdvancedCropScanner = lazy(() => import('../scanner/AdvancedCropScanner.jsx'));

function ScannerLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-slate-400">
      <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-farm-500 animate-spin mr-2" />
      Loading diagnostic engine…
    </div>
  );
}

/**
 * Geo-Farm — Agriculture Student Portal Dashboard
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Landing screen for the Agriculture Student Portal. Modern research-portal
 * layout distinct from the official officer aesthetic. Surfaces the
 * student's field contribution stats and recent crop scan logs (sourced
 * from AlertQueueContext entries created by the Edge-AI Scanner), and
 * launches the scanner itself in-place.
 */

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function StudentPortalDashboard() {
  const { user } = useAuth();
  const { alerts } = useAlertQueue();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [advancedScannerOpen, setAdvancedScannerOpen] = useState(false);

  const scanLogs = useMemo(
    () => alerts.filter((a) => a.source === ALERT_SOURCE.EDGE_AI_SCAN).slice(0, 8),
    [alerts]
  );

  const stats = useMemo(() => {
    const submitted = scanLogs.length;
    const flagged = scanLogs.filter((a) => a.status === 'FLAGGED' || a.status === 'VERIFIED').length;
    return {
      submitted,
      flagged,
      fieldsVisited: Math.max(1, Math.ceil(submitted / 2)),
      points: submitted * 15 + flagged * 10,
    };
  }, [scanLogs]);

  return (
    <div className="space-y-4">
      {/* Welcome strip */}
      <div className="rounded-xl border border-farm-700/40 bg-gradient-to-r from-farm-900/40 to-surface-900/60 p-4 sm:p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-farm-600/20 border border-farm-500/40 flex items-center justify-center shrink-0">
          <GraduationCap size={20} className="text-farm-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-100">
            Welcome, {user?.name || 'Researcher'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {user?.studentId} · {user?.institution || 'Agriculture Student Portal'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAdvancedScannerOpen(true)}
            className="flex items-center gap-2 border border-farm-600/50 text-farm-400 hover:bg-farm-600/10 text-xs sm:text-sm font-semibold rounded-lg px-3 sm:px-4 py-2.5 transition-colors"
          >
            <FlaskConical size={16} />
            <span className="hidden sm:inline">Advanced Diagnostic Scan</span>
            <span className="sm:hidden">Advanced</span>
          </button>
          <button
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-2 bg-farm-600 hover:bg-farm-500 text-white text-xs sm:text-sm font-semibold rounded-lg px-3 sm:px-4 py-2.5 transition-colors shadow-glow"
          >
            <ScanLine size={16} />
            <span className="hidden sm:inline">Launch AI Crop Scanner</span>
            <span className="sm:hidden">Scan</span>
          </button>
        </div>
      </div>

      {/* Field contribution stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <ScanLine size={15} className="text-farm-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Scans Submitted
            </span>
          </div>
          <CardStat value={stats.submitted} unit="this session" />
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical size={15} className="text-amber-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Flagged Findings
            </span>
          </div>
          <CardStat value={stats.flagged} unit="sent to officers" />
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <MapPinned size={15} className="text-sky-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Fields Visited
            </span>
          </div>
          <CardStat value={stats.fieldsVisited} unit="tracked plots" />
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={15} className="text-purple-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Contribution Points
            </span>
          </div>
          <CardStat value={stats.points} unit="research credits" />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent crop scan logs */}
        <Card className="lg:col-span-2">
          <CardHeader
            icon={ClipboardList}
            title="Recent Crop Scan Logs"
            subtitle="Your latest Edge-AI leaf scans and their outcomes"
          />
          {scanLogs.length === 0 ? (
            <div className="text-center py-8">
              <Sprout size={28} className="text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No scans logged yet</p>
              <p className="text-xs text-slate-600 mt-1">
                Launch the AI crop leaf scanner to record your first field observation.
              </p>
              <button
                onClick={() => setScannerOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-farm-400 hover:text-farm-300 transition-colors"
              >
                Start scanning <ArrowUpRight size={13} />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {scanLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-surface-950/40 p-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-farm-600/15 border border-farm-600/30 flex items-center justify-center shrink-0">
                    <ScanLine size={14} className="text-farm-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-200 truncate">
                      {log.title || 'Leaf scan result'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{timeAgo(log.createdAt)}</p>
                  </div>
                  <RiskBadge level={log.riskLevel} size="sm" />
                  <StatusBadge status={log.status} size="sm" />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Research tips / guidance panel */}
        <Card>
          <CardHeader icon={Sprout} title="Field Protocol" subtitle="Before you scan" />
          <ul className="space-y-2.5 text-xs text-slate-400">
            <li className="flex gap-2">
              <span className="text-farm-400 font-bold">1.</span>
              Capture the leaf in natural daylight, filling most of the frame.
            </li>
            <li className="flex gap-2">
              <span className="text-farm-400 font-bold">2.</span>
              Note the plot/block ID before submitting a flagged scan.
            </li>
            <li className="flex gap-2">
              <span className="text-farm-400 font-bold">3.</span>
              Flagged findings route directly to your assigned officer for verification.
            </li>
            <li className="flex gap-2">
              <span className="text-farm-400 font-bold">4.</span>
              Re-scan the same plant in 5–7 days to track advisory effectiveness.
            </li>
          </ul>
        </Card>
      </div>

      <Modal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="AI Crop Leaf Scanner"
        size="xl"
      >
        <Suspense fallback={<ScannerLoading />}>
          <EdgeAIScanner />
        </Suspense>
      </Modal>

      {/* Enterprise-grade multi-stage scanner: leaf validation -> TTA
          classification -> severity heatmap. Manages its own Modal
          internally (see components/scanner/AdvancedCropScanner.jsx). Only
          mounted once actually opened, so its lazy chunk isn't requested
          on every dashboard visit. */}
      {advancedScannerOpen && (
        <Suspense fallback={<ScannerLoading />}>
          <AdvancedCropScanner open={advancedScannerOpen} onClose={() => setAdvancedScannerOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
