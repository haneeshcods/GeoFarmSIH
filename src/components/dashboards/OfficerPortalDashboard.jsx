import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  Inbox,
  MapPin,
  Users,
  Radio,
  Megaphone,
  Send,
  CheckCircle2,
  Clock,
  ListChecks,
  Landmark,
} from 'lucide-react';
import { Card, CardHeader, CardStat } from '../ui/Card.jsx';
import { RiskBadge } from '../ui/Badge.jsx';
import { Modal } from '../ui/Modal.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAlertQueue, RISK_LEVEL } from '../../contexts/AlertQueueContext.jsx';
import OfficerDashboard from '../OfficerDashboard.jsx';

/**
 * Geo-Farm — Government Officer Portal Dashboard
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Landing screen for the Government Officer Portal. Official NIC aesthetic
 * (navy + saffron). Surfaces regional outbreak status and pending
 * verification claims sourced from AlertQueueContext, a simulated regional
 * outbreak map, and an emergency alert broadcast tool. The full AI-flagged
 * verification queue (existing OfficerDashboard.jsx) is reachable inline
 * below.
 */

// Simulated district grid for the regional outbreak map (no live GIS feed
// required here — GISMap.jsx / Leaflet provides the full satellite view
// elsewhere in the console).
const DISTRICTS = [
  { name: 'Nashik', risk: RISK_LEVEL.HIGH, farms: 214 },
  { name: 'Rahuri', risk: RISK_LEVEL.SEVERE, farms: 176 },
  { name: 'Pune', risk: RISK_LEVEL.MODERATE, farms: 302 },
  { name: 'Ahmednagar', risk: RISK_LEVEL.MODERATE, farms: 158 },
  { name: 'Solapur', risk: RISK_LEVEL.LOW, farms: 241 },
  { name: 'Kolhapur', risk: RISK_LEVEL.LOW, farms: 187 },
  { name: 'Sangli', risk: RISK_LEVEL.MODERATE, farms: 133 },
  { name: 'Satara', risk: RISK_LEVEL.LOW, farms: 165 },
  { name: 'Jalgaon', risk: RISK_LEVEL.HIGH, farms: 198 },
];

const RISK_DOT = {
  LOW: 'bg-risk-low',
  MODERATE: 'bg-risk-moderate',
  HIGH: 'bg-risk-high',
  SEVERE: 'bg-risk-severe',
  CRITICAL: 'bg-risk-critical',
};

function SimulatedOutbreakMap() {
  const [selected, setSelected] = useState(null);
  const active = selected ?? DISTRICTS[0];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <div className="col-span-3 sm:col-span-2 grid grid-cols-3 gap-2">
        {DISTRICTS.map((d) => (
          <button
            key={d.name}
            onClick={() => setSelected(d)}
            className={`relative rounded-lg border p-3 text-left transition-all ${
              active.name === d.name
                ? 'border-saffron-500/70 bg-nic-700/50 ring-1 ring-saffron-500/40'
                : 'border-slate-700/60 bg-surface-950/40 hover:border-slate-600'
            }`}
          >
            <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${RISK_DOT[d.risk]}`} />
            <p className="text-xs font-semibold text-slate-100">{d.name}</p>
            <p className="text-[10px] text-slate-500 mt-1">{d.farms} farms</p>
          </button>
        ))}
      </div>
      <div className="col-span-3 sm:col-span-1 rounded-lg border border-slate-700/60 bg-surface-950/40 p-3.5 flex flex-col">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-1">
          District Detail
        </p>
        <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
          <MapPin size={14} className="text-saffron-400" /> {active.name}
        </p>
        <div className="mt-2">
          <RiskBadge level={active.risk} size="sm" />
        </div>
        <p className="text-xs text-slate-400 mt-3">{active.farms} registered farms</p>
        <p className="text-[10px] text-slate-600 mt-auto pt-3">
          Simulated regional composite — not a live satellite feed
        </p>
      </div>
    </div>
  );
}

function EmergencyBroadcastModal({ open, onClose }) {
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState(RISK_LEVEL.HIGH);
  const [district, setDistrict] = useState(DISTRICTS[0].name);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    setSent(true);
  };

  const handleClose = () => {
    setSent(false);
    setMessage('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Emergency Alert Broadcast"
      footer={
        sent ? (
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-nic-600 hover:bg-nic-500 text-white transition-colors"
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-saffron-600 hover:bg-saffron-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send size={14} /> Broadcast Now
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="text-center py-4">
          <CheckCircle2 size={36} className="text-farm-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-100">Broadcast Dispatched</p>
          <p className="text-xs text-slate-400 mt-1.5">
            Emergency alert for <span className="text-slate-200">{district}</span> sent to all
            registered farmer channels (WhatsApp, SMS, IVR) at{' '}
            <RiskBadge level={severity} size="sm" />
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">Target District</label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-lg bg-surface-950/70 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-nic-500"
            >
              {DISTRICTS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">Severity</label>
            <div className="flex flex-wrap gap-2">
              {Object.values(RISK_LEVEL).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSeverity(lvl)}
                  className={`rounded-full transition-all ${severity === lvl ? 'ring-2 ring-saffron-400' : 'opacity-70'}`}
                >
                  <RiskBadge level={lvl} size="sm" />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">Broadcast Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="e.g. Bacterial blight outbreak confirmed in Block 4B — isolate affected rows and await officer visit..."
              className="w-full rounded-lg bg-surface-950/70 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-nic-500 resize-none"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function OfficerPortalDashboard() {
  const { user } = useAuth();
  const { pendingAlerts, verifiedAlerts, dispatchedAlerts, criticalCount, alerts } = useAlertQueue();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const totalFarmsMonitored = useMemo(
    () => DISTRICTS.reduce((sum, d) => sum + d.farms, 0),
    []
  );
  const outbreakDistricts = useMemo(
    () => DISTRICTS.filter((d) => d.risk === RISK_LEVEL.HIGH || d.risk === RISK_LEVEL.SEVERE).length,
    []
  );

  return (
    <div className="space-y-4">
      {/* Welcome strip */}
      <div className="rounded-xl border border-nic-700/60 bg-gradient-to-r from-nic-800/70 to-nic-900/40 p-4 sm:p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-nic-700/70 border border-saffron-500/40 flex items-center justify-center shrink-0">
          <Landmark size={20} className="text-saffron-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-100">
            Welcome, {user?.name || 'Officer'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {user?.deptCode} · {user?.issuer} · Regional Surveillance Command
          </p>
        </div>
        <button
          onClick={() => setBroadcastOpen(true)}
          className="ml-auto shrink-0 flex items-center gap-2 bg-saffron-600 hover:bg-saffron-500 text-white text-xs sm:text-sm font-semibold rounded-lg px-3 sm:px-4 py-2.5 transition-colors shadow-glow-red"
        >
          <Megaphone size={16} />
          <span className="hidden sm:inline">Emergency Broadcast</span>
          <span className="sm:hidden">Broadcast</span>
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-nic-700/50">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={15} className="text-risk-high" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Regional Outbreak Status
            </span>
          </div>
          <CardStat value={outbreakDistricts} unit={`/ ${DISTRICTS.length} districts elevated`} />
        </Card>
        <Card className="border-nic-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Inbox size={15} className="text-amber-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Pending Verification
            </span>
          </div>
          <CardStat value={pendingAlerts.length} unit="claims awaiting review" />
        </Card>
        <Card className="border-nic-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Users size={15} className="text-sky-400" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Farms Monitored
            </span>
          </div>
          <CardStat value={totalFarmsMonitored.toLocaleString()} unit="across region" />
        </Card>
        <Card className="border-nic-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Radio size={15} className="text-risk-severe" />
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Critical Signals
            </span>
          </div>
          <CardStat value={criticalCount} unit="require action" />
        </Card>
      </div>

      {/* Simulated regional outbreak map */}
      <Card className="border-nic-700/50">
        <CardHeader
          icon={MapPin}
          title="Simulated Regional Outbreak Map"
          subtitle="District-level composite risk across the surveillance region"
        />
        <SimulatedOutbreakMap />
      </Card>

      {/* Verification claims summary */}
      <Card className="border-nic-700/50">
        <CardHeader
          icon={ListChecks}
          title="Pending Verification Claims"
          subtitle="AI-flagged field reports awaiting officer audit"
          action={
            <button
              onClick={() => setShowQueue((v) => !v)}
              className="text-xs font-semibold text-saffron-400 hover:text-saffron-300 transition-colors"
            >
              {showQueue ? 'Hide queue' : 'Open queue'}
            </button>
          }
        />
        <div className="grid grid-cols-3 gap-3 mb-1">
          <div className="rounded-lg border border-slate-700/60 bg-surface-950/40 p-3 text-center">
            <p className="text-lg font-bold text-slate-100 tabular-nums">{pendingAlerts.length}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5 flex items-center justify-center gap-1">
              <Clock size={10} /> Pending
            </p>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-surface-950/40 p-3 text-center">
            <p className="text-lg font-bold text-slate-100 tabular-nums">{verifiedAlerts.length}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Verified</p>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-surface-950/40 p-3 text-center">
            <p className="text-lg font-bold text-slate-100 tabular-nums">{dispatchedAlerts.length}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Dispatched</p>
          </div>
        </div>
        {alerts.length === 0 && (
          <p className="text-xs text-slate-500 mt-3">
            No claims in the system yet — they will appear here once a student or sensor flags a field.
          </p>
        )}
      </Card>

      {/* Inline full verification queue (existing detailed workflow) */}
      {showQueue && (
        <div className="rounded-xl border border-nic-700/50 overflow-hidden">
          <OfficerDashboard />
        </div>
      )}

      <EmergencyBroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
  );
}
