import React, { useState } from 'react';
import {
  ShieldCheck,
  GraduationCap,
  Landmark,
  Leaf,
  Mail,
  KeyRound,
  UserRound,
  Building2,
  AlertCircle,
  ArrowRight,
  Languages,
  Clock,
  Loader2,
} from 'lucide-react';
import { useAuth, ROLES } from '../../contexts/AuthContext.jsx';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

/**
 * Geo-Farm — Login Gateway
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Entry-point authentication screen. Presented as a centered card/dialog
 * ("auth modal") over the full viewport whenever no valid session exists.
 * Toggles between two distinct verification flows:
 *   - Government Officer Portal  (official email + Department Code)
 *   - Agriculture Student Portal (academic email + Student/ABC ID)
 *
 * AUDIT FIX: previously read a single shared `error` string from
 * AuthContext, so only one invalid field could ever be shown at a time —
 * e.g. an invalid email AND an invalid dept code submitted together would
 * only surface the email error; fixing it and resubmitting was needed just
 * to discover the code was also invalid. AuthContext now returns a
 * `fieldErrors` object (`{ email?, code? }`) populated from a single
 * validation pass, so both are shown together immediately.
 */

const ERROR_COPY = {
  officerEmailInvalid: 'Enter a valid official email ending in @gov.in or @nic.in',
  deptCodeInvalid: 'Department Code must be 4–15 characters with letters and numbers (e.g. AGR-2024)',
  studentEmailInvalid: 'Enter a valid academic email ending in .ac.in or .edu',
  studentIdInvalid: 'Student / ABC ID must be 6–20 alphanumeric characters',
};

function Field({ icon: Icon, label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
        <Icon size={13} className="text-slate-500" />
        {label}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-risk-severe flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg bg-surface-950/70 border border-slate-700 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow';

export default function AuthGateway() {
  const { loginOfficer, loginStudent, fieldErrors, clearErrors, sessionJustExpired } = useAuth();
  const { language, toggleLanguage } = useLanguage();
  const [portal, setPortal] = useState(ROLES.OFFICER);

  const [officerForm, setOfficerForm] = useState({ name: '', email: '', deptCode: '' });
  const [studentForm, setStudentForm] = useState({
    name: '',
    email: '',
    studentId: '',
    institution: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const switchPortal = (next) => {
    setPortal(next);
    clearErrors();
  };

  // FIX (medium, dead UX state): both handlers used to call
  // `setSubmitting(true)` immediately followed by `setSubmitting(false)`
  // in the same synchronous event handler. React batches state updates
  // inside an event handler into a single re-render, so `submitting` only
  // ever committed its FINAL value (`false`) — the "verifying" disabled
  // state on the submit button never actually painted to the screen, even
  // though the code looked like it implemented one. `loginOfficer` /
  // `loginStudent` are synchronous validators here (no real network call),
  // so we now explicitly defer the reset by one tick, giving the button's
  // disabled/loading state a real (if brief) window to render — this also
  // reads correctly to a demo audience as "verifying your credentials"
  // rather than the button flashing with no visible feedback at all.
  const handleOfficerSubmit = (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setTimeout(() => {
      loginOfficer(officerForm);
      setSubmitting(false);
    }, 450);
  };

  const handleStudentSubmit = (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setTimeout(() => {
      loginStudent(studentForm);
      setSubmitting(false);
    }, 450);
  };

  const isOfficer = portal === ROLES.OFFICER;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-surface-950 relative overflow-hidden px-4 py-8">
      {/* Ambient backdrop */}
      <div
        className={`absolute inset-0 transition-colors duration-500 ${
          isOfficer
            ? 'bg-[radial-gradient(circle_at_20%_20%,rgba(30,63,122,0.35),transparent_55%),radial-gradient(circle_at_80%_75%,rgba(255,153,51,0.12),transparent_50%)]'
            : 'bg-[radial-gradient(circle_at_20%_20%,rgba(22,163,74,0.25),transparent_55%),radial-gradient(circle_at_80%_75%,rgba(14,116,144,0.18),transparent_50%)]'
        }`}
      />
      <div className="absolute top-0 left-0 right-0 h-1.5 flex">
        <div className="flex-1 bg-saffron-500" />
        <div className="flex-1 bg-white" />
        <div className="flex-1 bg-farm-600" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-surface-900 border border-slate-700 flex items-center justify-center shadow-glow mb-3">
            <Leaf size={26} className="text-farm-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-100">Geo-Farm National Portal</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time AI/GIS Crop Disease &amp; Pest Surveillance · SIH26131
          </p>
        </div>

        {/* Session-expired notice */}
        {sessionJustExpired && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
            <Clock size={14} className="shrink-0" />
            Your session expired for security. Please sign in again.
          </div>
        )}

        {/* Auth card */}
        <div className="glass-panel bg-surface-900/90 rounded-2xl border border-slate-700/60 shadow-2xl overflow-hidden">
          {/* Portal toggle */}
          <div className="grid grid-cols-2 border-b border-slate-800">
            <button
              type="button"
              onClick={() => switchPortal(ROLES.OFFICER)}
              className={`flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors ${
                isOfficer
                  ? 'bg-nic-600/40 text-white border-b-2 border-saffron-500'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
              }`}
            >
              <Landmark size={16} /> Government Officer
            </button>
            <button
              type="button"
              onClick={() => switchPortal(ROLES.STUDENT)}
              className={`flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors ${
                !isOfficer
                  ? 'bg-farm-600/25 text-white border-b-2 border-farm-500'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
              }`}
            >
              <GraduationCap size={16} /> Agriculture Student
            </button>
          </div>

          <div className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <ShieldCheck size={16} className={isOfficer ? 'text-saffron-400' : 'text-farm-400'} />
              <p className="text-xs text-slate-400">
                {isOfficer
                  ? 'Restricted access — verified with official Government email + Department Code.'
                  : 'Verified with your institution\u2019s academic email + Student / ABC ID.'}
              </p>
            </div>

            {isOfficer ? (
              <form className="space-y-4" onSubmit={handleOfficerSubmit}>
                <Field icon={UserRound} label="Full Name">
                  <input
                    className={`${inputClass} focus:ring-nic-500 focus:border-nic-500`}
                    placeholder="e.g. Anjali Sharma"
                    value={officerForm.name}
                    onChange={(e) => setOfficerForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field
                  icon={Mail}
                  label="Official Email"
                  error={fieldErrors.email ? ERROR_COPY[fieldErrors.email] : null}
                >
                  <input
                    required
                    type="email"
                    className={`${inputClass} focus:ring-nic-500 focus:border-nic-500`}
                    placeholder="officer.name@agri.gov.in"
                    value={officerForm.email}
                    onChange={(e) => setOfficerForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
                <Field
                  icon={KeyRound}
                  label="Department Code"
                  error={fieldErrors.code ? ERROR_COPY[fieldErrors.code] : null}
                >
                  <input
                    required
                    className={`${inputClass} focus:ring-nic-500 focus:border-nic-500 uppercase`}
                    placeholder="AGR-2024"
                    value={officerForm.deptCode}
                    onChange={(e) => setOfficerForm((f) => ({ ...f, deptCode: e.target.value }))}
                  />
                </Field>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 bg-nic-600 hover:bg-nic-500 text-white font-semibold text-sm rounded-lg py-3 transition-colors shadow-glow disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Verifying credentials…
                    </>
                  ) : (
                    <>
                      Verify &amp; Enter Officer Portal <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={handleStudentSubmit}>
                <Field icon={UserRound} label="Full Name">
                  <input
                    className={`${inputClass} focus:ring-farm-500 focus:border-farm-500`}
                    placeholder="e.g. Rohit Patil"
                    value={studentForm.name}
                    onChange={(e) => setStudentForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field
                  icon={Mail}
                  label="Academic Email"
                  error={fieldErrors.email ? ERROR_COPY[fieldErrors.email] : null}
                >
                  <input
                    required
                    type="email"
                    className={`${inputClass} focus:ring-farm-500 focus:border-farm-500`}
                    placeholder="rohit.patil@mpkv.ac.in"
                    value={studentForm.email}
                    onChange={(e) => setStudentForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
                <Field
                  icon={KeyRound}
                  label="Student / ABC ID"
                  error={fieldErrors.code ? ERROR_COPY[fieldErrors.code] : null}
                >
                  <input
                    required
                    className={`${inputClass} focus:ring-farm-500 focus:border-farm-500 uppercase`}
                    placeholder="ABC240391056"
                    value={studentForm.studentId}
                    onChange={(e) => setStudentForm((f) => ({ ...f, studentId: e.target.value }))}
                  />
                </Field>
                <Field icon={Building2} label="Institution (optional)">
                  <input
                    className={`${inputClass} focus:ring-farm-500 focus:border-farm-500`}
                    placeholder="College of Agriculture, Rahuri"
                    value={studentForm.institution}
                    onChange={(e) => setStudentForm((f) => ({ ...f, institution: e.target.value }))}
                  />
                </Field>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 bg-farm-600 hover:bg-farm-500 text-white font-semibold text-sm rounded-lg py-3 transition-colors shadow-glow disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Verifying credentials…
                    </>
                  ) : (
                    <>
                      Verify &amp; Enter Student Portal <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-5">
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Languages size={13} />
            {language === 'en' ? 'मराठीत पहा' : 'View in English'}
          </button>
          <span className="text-slate-700">|</span>
          <p className="text-[11px] text-slate-600">
            Demo credential format-check only — no personal data is transmitted.
          </p>
        </div>
      </div>
    </div>
  );
}
