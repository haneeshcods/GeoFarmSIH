import React, { useState } from 'react';
import {
  LayoutDashboard,
  Radio,
  Bug,
  Map as MapIcon,
  ScanLine,
  ShieldCheck,
  MessageSquareWarning,
  Leaf,
  Languages,
  Menu,
  X,
} from 'lucide-react';
import { useLanguage } from './contexts/LanguageContext.jsx';
import { useAlertQueue } from './contexts/AlertQueueContext.jsx';
import { useAutoAlertMonitor } from './hooks/useAutoAlertMonitor.js';

// NOTE: These panel components are built in later steps. App.jsx wires up
// navigation now; each import below corresponds to an upcoming file.
import SensorTelemetryPanel from './components/SensorTelemetryPanel.jsx';
import PestForecastPanel from './components/PestForecastPanel.jsx';
import GISMap from './components/GISMap.jsx';
import EdgeAIScanner from './components/EdgeAIScanner.jsx';
import OfficerDashboard from './components/OfficerDashboard.jsx';
import AlertCenter from './components/AlertCenter.jsx';

const NAV_ITEMS = [
  { key: 'overview', labelKey: 'dashboard', icon: LayoutDashboard },
  { key: 'telemetry', labelKey: 'telemetry', icon: Radio },
  { key: 'pestForecast', labelKey: 'pestForecast', icon: Bug },
  { key: 'gisMap', labelKey: 'gisMap', icon: MapIcon },
  { key: 'scanner', labelKey: 'scanner', icon: ScanLine },
  { key: 'officerDashboard', labelKey: 'officerDashboard', icon: ShieldCheck },
  { key: 'alertCenter', labelKey: 'alertCenter', icon: MessageSquareWarning },
];

export default function App() {
  const [activePanel, setActivePanel] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t, language, toggleLanguage, isMarathi } = useLanguage();
  const { pendingAlerts, criticalCount } = useAlertQueue();
  useAutoAlertMonitor(); // real-time threshold watcher — auto-raises officer alerts

  const renderPanel = () => {
    switch (activePanel) {
      case 'telemetry':
        return <SensorTelemetryPanel />;
      case 'pestForecast':
        return <PestForecastPanel />;
      case 'gisMap':
        return <GISMap />;
      case 'scanner':
        return <EdgeAIScanner />;
      case 'officerDashboard':
        return <OfficerDashboard />;
      case 'alertCenter':
        return <AlertCenter />;
      case 'overview':
      default:
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-panel rounded-xl p-5">
              <SensorTelemetryPanel compact />
            </div>
            <div className="glass-panel rounded-xl p-5">
              <PestForecastPanel compact />
            </div>
            <div className="glass-panel rounded-xl p-5 lg:col-span-2">
              <GISMap compact />
            </div>
          </div>
        );
    }
  };

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
        className={`fixed lg:static z-40 top-0 left-0 h-full w-64 shrink-0 border-r border-slate-800 bg-surface-900/95 backdrop-blur-md transform transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-2 px-5 h-16 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-farm-600 flex items-center justify-center shadow-glow">
            <Leaf size={18} className="text-white" />
          </div>
          <div className="leading-tight">
            <p className={`font-bold text-slate-100 ${isMarathi ? 'font-devanagari' : ''}`}>
              {t('appName')}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              SIH26131
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
          {NAV_ITEMS.map(({ key, labelKey, icon: Icon }) => {
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
                    ? 'bg-farm-600/20 text-farm-400 border border-farm-600/40'
                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                } ${isMarathi ? 'font-devanagari' : ''}`}
              >
                <Icon size={18} />
                <span className="flex-1 text-left">{t(labelKey)}</span>
                {showBadge && (
                  <span className="text-[10px] font-bold bg-risk-severe text-white rounded-full px-1.5 py-0.5">
                    {pendingAlerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800">
          <button
            onClick={toggleLanguage}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800/60 transition-colors"
          >
            <Languages size={16} />
            <span>{t('language')}:</span>
            <span className="ml-auto font-semibold text-farm-400">
              {language === 'en' ? 'EN' : 'मर'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-800 bg-surface-900/60 backdrop-blur-md flex items-center px-4 lg:px-6 gap-3 sticky top-0 z-20">
          <button
            className="lg:hidden text-slate-300"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu size={22} />
          </button>
          <div>
            <h1 className={`text-base font-semibold text-slate-100 ${isMarathi ? 'font-devanagari' : ''}`}>
              {t(NAV_ITEMS.find((n) => n.key === activePanel)?.labelKey ?? 'dashboard')}
            </h1>
            <p className="text-xs text-slate-500 hidden sm:block">{t('tagline')}</p>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {criticalCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-risk-severe">
                <span className="live-dot" style={{ backgroundColor: '#dc2626' }} />
                {criticalCount} {t('riskCritical')}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs font-medium text-farm-400">
              <span className="live-dot" />
              {t('liveData')}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">{renderPanel()}</main>
      </div>
    </div>
  );
}
