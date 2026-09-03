import React, { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Bug, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardStat } from './ui/Card.jsx';
import { RiskBadge, Badge } from './ui/Badge.jsx';
import { SegmentToggle } from './ui/Toggle.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { usePestForecast } from '../hooks/usePestForecast.js';
import { classifyEmergenceRisk } from '../utils/mathModels.js';

/**
 * Geo-Farm — Smart Traps Swarm Forecaster Panel
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Displays live simulated pheromone trap catch counts alongside
 * thermal degree-day (GDD) accumulation, forecasting pest emergence
 * (Armyworm / Fruit Fly) 7-14 days ahead.
 *
 * BUGFIX (B6): emergence-risk banding used to be duplicated here and in
 * useAutoAlertMonitor.js. Now both import classifyEmergenceRisk from
 * mathModels.js, so the badge an officer sees and the threshold that
 * triggers an auto-alert can never silently drift apart.
 */

export default function PestForecastPanel({ compact = false }) {
  const { t } = useLanguage();
  const { traps, swarmAlerts } = usePestForecast('*');
  const [selectedTrapId, setSelectedTrapId] = useState(traps[0]?.trapId ?? 'TRAP-NSK-A1');
  const { reading, history } = usePestForecast(selectedTrapId, { historyLength: 24 });

  const trapOptions = useMemo(
    () => traps.map((tr) => ({ value: tr.trapId, label: tr.label.replace(' — ', ' · ') })),
    [traps]
  );

  const chartData = useMemo(
    () =>
      history.map((h, i) => ({
        tick: i + 1,
        catch: h.nightlyCatch,
        avgCatch: h.avgCatch7Night,
        emergence: h.degreeDay.percentToEmergence,
      })),
    [history]
  );

  if (!reading) {
    return (
      <Card>
        <CardHeader icon={Bug} title={t('pestForecast')} subtitle="Initializing trap network..." />
      </Card>
    );
  }

  const riskLevel = classifyEmergenceRisk(reading.degreeDay.percentToEmergence);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={Bug}
          title={t('pestForecast')}
          subtitle={`${reading.label} · ${reading.pestLabel}`}
          action={
            !compact && (
              <SegmentToggle
                size="sm"
                value={selectedTrapId}
                onChange={setSelectedTrapId}
                options={trapOptions.slice(0, 4)}
              />
            )
          }
        />

        {reading.swarmImminent && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-risk-severe/10 border border-risk-severe/30 text-risk-severe text-xs font-medium">
            <AlertTriangle size={14} />
            {t('swarmImminentBanner')}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <CardStat label={t('trapCount')} value={reading.nightlyCatch} unit={t('nightlyCatchUnit')} />
          <CardStat
            label={t('sevenNightAvg')}
            value={reading.avgCatch7Night}
            unit={`/ ${reading.economicThreshold} ${t('threshUnit')}`}
          />
          <CardStat
            label={t('degreeDays')}
            value={reading.degreeDay.cumulativeGdd}
            unit={`/ ${reading.degreeDay.emergenceThreshold} GDD`}
          />
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              {t('emergenceRisk')}
            </span>
            <div className="mt-1">
              <RiskBadge level={riskLevel} pulse />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Clock size={13} />
            {reading.degreeDay.projectedDaysToEmergence !== null
              ? `${reading.degreeDay.projectedDaysToEmergence} ${t('daysToEmergence')}`
              : t('insufficientTrend')}
          </span>
          <span className="flex items-center gap-1.5">
            <TrendingUp size={13} />
            {reading.degreeDay.percentToEmergence}% {t('percentOfThreshold')}
          </span>
        </div>

        {!compact && (
          <div className="h-52 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="catchGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="emergenceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="tick" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} width={30} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  width={30}
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
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="catch"
                  name="Nightly catch"
                  stroke="#dc2626"
                  fill="url(#catchGradient)"
                  strokeWidth={2}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="emergence"
                  name="Emergence %"
                  stroke="#eab308"
                  fill="url(#emergenceGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {!compact && swarmAlerts.length > 0 && (
        <Card>
          <CardHeader
            icon={AlertTriangle}
            title={t('activeSwarmWatch')}
            subtitle={`${swarmAlerts.length} ${t('trapsExceeding')}`}
          />
          <div className="space-y-2">
            {swarmAlerts.map((alert) => (
              <div
                key={alert.trapId}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{alert.label}</p>
                  <p className="text-xs text-slate-500">{alert.pestLabel}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge color="amber" size="sm">
                    {alert.avgCatch7Night}{t('nightlyCatchUnit')}
                  </Badge>
                  <RiskBadge level={classifyEmergenceRisk(alert.degreeDay.percentToEmergence)} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
