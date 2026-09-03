import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Thermometer, Droplets, Waves, Radio } from 'lucide-react';
import { Card, CardHeader, CardStat } from './ui/Card.jsx';
import { RiskBadge } from './ui/Badge.jsx';
import { SegmentToggle } from './ui/Toggle.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useTelemetryStream } from '../hooks/useTelemetryStream.js';
import { telemetryEngine } from '../services/telemetryService.js';

/**
 * Geo-Farm — Sensor Telemetry Panel
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Displays live shared-node IoT readings (temperature, humidity, leaf
 * wetness duration) and the derived Magarey fungal infection risk for
 * Downy Mildew / Powdery Mildew, per node, with a trend chart.
 */

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function SensorTelemetryPanel({ compact = false }) {
  const { t, isMarathi } = useLanguage();
  // BUGFIX (D2): previously used useTelemetryStream('*') purely to read the
  // static `nodes` list, while silently discarding `readingsByNode`. That
  // forced a full live subscription — and a re-render on every single
  // node's broadcast tick (4x per interval) — for data this component
  // never used. Node metadata (id, label, lat/lng, crop) never changes at
  // runtime, so we read it once directly from the engine instead.
  const [nodes] = useState(() => telemetryEngine.listNodes());
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.nodeId ?? 'NODE-NSK-01');
  const { reading, history } = useTelemetryStream(selectedNodeId, { historyLength: 24 });

  const nodeOptions = useMemo(
    () => nodes.map((n) => ({ value: n.nodeId, label: n.label.replace(' — ', ' · ') })),
    [nodes]
  );

  const chartData = useMemo(
    () =>
      history.map((h) => ({
        time: formatTime(h.timestamp),
        temp: h.smoothedTemp,
        lwd: h.lwdHours,
        risk: Math.round(h.risk.dominantRiskScore * 100),
      })),
    [history]
  );

  if (!reading) {
    return (
      <Card>
        <CardHeader icon={Radio} title={t('telemetry')} subtitle="Initializing sensor stream..." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={Radio}
          title={t('telemetry')}
          subtitle={`${reading.label} · ${reading.radiusKm} ${t('sharedNodeRadius')} · ${reading.farmsServed} ${t('farmsServed')}`}
          action={
            !compact && (
              <SegmentToggle
                size="sm"
                value={selectedNodeId}
                onChange={setSelectedNodeId}
                options={nodeOptions.slice(0, 4)}
              />
            )
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <CardStat
            label={t('temperature')}
            value={reading.temperature.toFixed(1)}
            unit="°C"
          />
          <CardStat
            label={t('humidity')}
            value={reading.humidity}
            unit="%"
          />
          <CardStat
            label={t('leafWetness')}
            value={reading.lwdHours.toFixed(1)}
            unit="hrs"
          />
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              {t('infectionRisk')}
            </span>
            <div className="mt-1">
              <RiskBadge level={reading.risk.dominantRiskLevel} pulse />
            </div>
          </div>
        </div>

        {!compact && (
          <div className="h-52 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={30} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} width={30} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  width={30}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="temp"
                  name="Temp °C"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="lwd"
                  name="LWD hrs"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="risk"
                  name="Risk %"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PathogenRiskCard icon={Droplets} data={reading.risk.downyMildew} isMarathi={isMarathi} t={t} />
          <PathogenRiskCard icon={Waves} data={reading.risk.powderyMildew} isMarathi={isMarathi} t={t} />
        </div>
      )}
    </div>
  );
}

function PathogenRiskCard({ icon: Icon, data, isMarathi, t }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate">{data.pathogen}</p>
          <p className="text-xs text-slate-500">
            {t('minWetnessRequired')}: {data.minWetnessRequired} hrs
          </p>
        </div>
        <RiskBadge level={data.riskLevel} size="sm" />
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${data.riskScore * 100}%`,
            backgroundColor:
              data.riskLevel === 'LOW'
                ? '#22c55e'
                : data.riskLevel === 'MODERATE'
                ? '#eab308'
                : data.riskLevel === 'HIGH'
                ? '#f97316'
                : '#dc2626',
          }}
        />
      </div>
    </Card>
  );
}
