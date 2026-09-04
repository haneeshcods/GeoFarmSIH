import React, { useState, useEffect } from 'react';
import {
  Landmark,
  Languages,
  Type,
  Contrast,
  LogOut,
  ShieldCheck,
  GraduationCap,
  Menu,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

/**
 * Geo-Farm — Government-Style Header
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Shared top bar for both portals: tricolor strip + official branding,
 * accessibility controls (text size, high-contrast), language toggle, and
 * a role-aware identity chip with sign-out. Accent color adapts to the
 * signed-in role (navy/saffron for officers, farm-green for students).
 */

const FONT_STEPS = ['text-[13px]', 'text-sm', 'text-base', 'text-lg'];
const FONT_STEP_LABELS = ['S', 'M', 'L', 'XL'];
const A11Y_STORAGE_KEY = 'geofarm_a11y_prefs';

/** AUDIT FIX (low): accessibility prefs (font step + high contrast) were
 *  plain component state, reset to defaults on every logout/login because
 *  GovHeader unmounts along with the rest of the authenticated Console.
 *  Persisting them means a user's chosen text size/contrast survives across
 *  sessions, matching how LanguageContext already persists its preference. */
function loadA11yPrefs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(A11Y_STORAGE_KEY) || 'null');
    return {
      fontStep: Number.isInteger(stored?.fontStep) && stored.fontStep >= 0 && stored.fontStep < FONT_STEPS.length
        ? stored.fontStep
        : 1,
      highContrast: typeof stored?.highContrast === 'boolean' ? stored.highContrast : false,
    };
  } catch (err) {
    return { fontStep: 1, highContrast: false };
  }
}

export default function GovHeader({ onMenuClick }) {
  const { user, isOfficer, logout } = useAuth();
  const { language, toggleLanguage, isMarathi } = useLanguage();
  const [{ fontStep, highContrast }, setA11yPrefs] = useState(loadA11yPrefs);

  useEffect(() => {
    document.documentElement.className = document.documentElement.className
      .split(' ')
      .filter((c) => c && !FONT_STEPS.includes(c))
      .concat(FONT_STEPS[fontStep])
      .join(' ');
  }, [fontStep]);

  useEffect(() => {
    document.documentElement.classList.toggle('gf-high-contrast', highContrast);
  }, [highContrast]);

  useEffect(() => {
    try {
      window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify({ fontStep, highContrast }));
    } catch (err) {
      // ignore persistence failures (private browsing, quota, etc.)
    }
  }, [fontStep, highContrast]);

  const setFontStep = (updater) =>
    setA11yPrefs((prev) => ({ ...prev, fontStep: typeof updater === 'function' ? updater(prev.fontStep) : updater }));
  const setHighContrast = (updater) =>
    setA11yPrefs((prev) => ({
      ...prev,
      highContrast: typeof updater === 'function' ? updater(prev.highContrast) : updater,
    }));

  return (
    <header className="sticky top-0 z-30">
      {/* National tricolor strip */}
      <div className="h-1 flex">
        <div className="flex-1 bg-saffron-500" />
        <div className="flex-1 bg-white" />
        <div className="flex-1 bg-farm-600" />
      </div>

      <div
        className={`flex items-center gap-3 px-4 lg:px-6 h-16 border-b backdrop-blur-md ${
          isOfficer
            ? 'bg-nic-900/95 border-nic-700'
            : 'bg-surface-900/90 border-slate-800'
        }`}
      >
        <button
          className="lg:hidden text-slate-300"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>

        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
            isOfficer
              ? 'bg-nic-700/60 border-saffron-500/50'
              : 'bg-farm-600/15 border-farm-600/30'
          }`}
        >
          <Landmark size={18} className={isOfficer ? 'text-saffron-400' : 'text-farm-400'} />
        </div>

        <div className="leading-tight min-w-0">
          <p className={`font-bold text-slate-100 truncate ${isMarathi ? 'font-devanagari' : ''}`}>
            {isOfficer ? 'Ministry of Agriculture & Farmers Welfare' : 'Geo-Farm Student Research Portal'}
          </p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider truncate">
            {isOfficer ? 'National Crop Surveillance Grid · SIH26131' : 'Agricultural Field Research Network · SIH26131'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          {/* Accessibility: text size */}
          <div className="hidden sm:flex items-center rounded-lg border border-slate-700 bg-surface-950/50 overflow-hidden">
            <button
              onClick={() => setFontStep((s) => Math.max(0, s - 1))}
              className="px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
              aria-label="Decrease text size"
              title="Decrease text size"
            >
              <Type size={12} />
            </button>
            {/* AUDIT FIX: this previously read `A{fontStep - 1 >= 0 ? '' : ''}`
                — both ternary branches were an empty string, so it always
                rendered a bare "A" with zero actual feedback on the current
                step. Now shows the live size label (S/M/L/XL). */}
            <span
              className="px-1.5 text-[10px] text-slate-500 tabular-nums w-5 text-center"
              aria-live="polite"
            >
              {FONT_STEP_LABELS[fontStep]}
            </span>
            <button
              onClick={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
              className="px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
              aria-label="Increase text size"
              title="Increase text size"
            >
              <Type size={16} />
            </button>
          </div>

          {/* Accessibility: contrast */}
          <button
            onClick={() => setHighContrast((c) => !c)}
            aria-pressed={highContrast}
            title="Toggle high contrast"
            className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
              highContrast
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Contrast size={15} />
          </button>

          {/* Language toggle */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
            title="Toggle language"
          >
            <Languages size={13} />
            <span className="hidden sm:inline">{language === 'en' ? 'EN' : 'मर'}</span>
          </button>

          {/* Identity + logout */}
          {user && (
            <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-700 ml-0.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isOfficer ? 'bg-nic-600/60 text-saffron-300' : 'bg-farm-600/25 text-farm-300'
                }`}
              >
                {isOfficer ? <ShieldCheck size={14} /> : <GraduationCap size={14} />}
              </div>
              <div className="hidden md:block leading-tight">
                <p className="text-xs font-semibold text-slate-100 truncate max-w-[140px]">
                  {user.name}
                </p>
                <p className="text-[10px] text-slate-500 truncate max-w-[140px]">
                  {isOfficer ? user.deptCode : user.studentId}
                </p>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-risk-severe hover:bg-risk-severe/10 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
