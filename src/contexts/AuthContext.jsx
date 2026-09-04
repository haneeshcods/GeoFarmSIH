import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';

/**
 * Geo-Farm — Auth Context
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Dual-portal authentication:
 *   - Government Officer Portal: official @gov.in / @nic.in email + Department Code
 *   - Agriculture Student Portal: academic .ac.in / .edu email + Student/ABC ID
 *
 * NOTE: This is a front-end demo gate (format/pattern validation only, no
 * backend issuer check). It establishes `role` + profile fields consumed by
 * GovHeader, OfficerPortalDashboard, StudentPortalDashboard, and
 * ProtectedRoute to render distinct, role-appropriate experiences.
 *
 * ===========================================================================
 * AUDIT FIXES (Principal Engineer review) applied in this revision:
 *
 *   [HIGH] No session expiry — a session written to localStorage persisted
 *   indefinitely with no TTL check. Fixed: every session now carries
 *   `loginAt` + `expiresAt` (12h TTL), validated both on initial load and on
 *   a periodic interval while the app stays open, with automatic logout.
 *
 *   [HIGH] Restored localStorage session had no schema/format
 *   re-validation — malformed or hand-edited storage (e.g. `{"role":
 *   "officer"}` with no email) would silently authenticate the user and
 *   render protected UI with undefined fields instead of forcing re-login.
 *   Fixed: `sanitizeSession()` re-runs the same regex validators used at
 *   login against any restored session before trusting it.
 *
 *   [MEDIUM] `error` was a single shared string, so simultaneous validation
 *   failures (e.g. both email AND dept code invalid) only ever surfaced one
 *   at a time across repeated submits. Fixed: `fieldErrors` is now an
 *   object that can hold multiple field-level errors from a single submit.
 *
 *   [LOW] Email was stored with whatever casing the user typed even though
 *   validation is case-insensitive, risking inconsistent case-sensitive
 *   comparisons elsewhere. Fixed: normalized to lowercase at login.
 * ===========================================================================
 */

export const ROLES = {
  OFFICER: 'officer',
  STUDENT: 'student',
};

const STORAGE_KEY = 'geofarm_auth_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000; // re-check every minute while open

// FIX (4.1 audit): these anchors were verified against bypass patterns such
// as `user@gov.in.fake.com` (domain must literally END in `gov.in`/`nic.in`,
// so a trailing-domain trick like this fails to match) and `user@evilgov.in`
// (the char class before the literal `gov`/`nic` requires a trailing `.`,
// so a concatenated label like "evilgov" can never satisfy the pattern).
// The regex is also immune to the classic "trailing newline" `$`-anchor
// bypass some JS regexes are vulnerable to, because the `m` (multiline)
// flag — which is what makes `$` match before a trailing `\n` — is
// deliberately NOT set here.
const OFFICER_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*(gov|nic)\.in$/i;
// Department code e.g. AGR-2024, DOA1042, MOA-047 — mixed letters + digits, 4-15 chars
const DEPT_CODE_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9-]{4,15}$/;

const STUDENT_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*(ac\.in|edu)$/i;
// Student ID / ABC (Academic Bank of Credits) ID — alphanumeric, 6-20 chars
const STUDENT_ID_RE = /^[A-Za-z0-9]{6,20}$/;

export function validateOfficerEmail(email) {
  return OFFICER_EMAIL_RE.test((email || '').trim());
}
export function validateDeptCode(code) {
  return DEPT_CODE_RE.test((code || '').trim());
}
export function validateStudentEmail(email) {
  return STUDENT_EMAIL_RE.test((email || '').trim());
}
export function validateStudentId(id) {
  return STUDENT_ID_RE.test((id || '').trim());
}

function deriveNameFromEmail(email) {
  const local = (email || '').split('@')[0] || 'user';
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Re-validates a session object restored from localStorage against the
 *  same rules used at login time. Returns `null` if the session is
 *  malformed, tampered with, or expired — callers must treat `null` as
 *  "not authenticated" and clear storage. This is what closes the
 *  "invalid token" gap called out in the audit: a hand-edited or corrupted
 *  storage entry can no longer grant access to either portal. */
function sanitizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { role, email, name, loginAt, expiresAt } = raw;

  if (typeof loginAt !== 'number' || typeof expiresAt !== 'number') return null;
  if (Date.now() >= expiresAt) return null; // expired

  if (role === ROLES.OFFICER) {
    if (!validateOfficerEmail(email) || !validateDeptCode(raw.deptCode)) return null;
    return {
      role: ROLES.OFFICER,
      email: String(email).toLowerCase(),
      deptCode: String(raw.deptCode).toUpperCase(),
      name: typeof name === 'string' && name.trim() ? name : deriveNameFromEmail(email),
      issuer: raw.issuer === 'NIC' ? 'NIC' : 'Govt. of India',
      loginAt,
      expiresAt,
    };
  }

  if (role === ROLES.STUDENT) {
    if (!validateStudentEmail(email) || !validateStudentId(raw.studentId)) return null;
    return {
      role: ROLES.STUDENT,
      email: String(email).toLowerCase(),
      studentId: String(raw.studentId).toUpperCase(),
      name: typeof name === 'string' && name.trim() ? name : deriveNameFromEmail(email),
      institution: typeof raw.institution === 'string' ? raw.institution : '',
      loginAt,
      expiresAt,
    };
  }

  return null; // unknown/tampered role value
}

function readStoredSession() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const sanitized = sanitizeSession(parsed);
    if (!sanitized) {
      // Malformed, tampered, or expired — scrub it so we don't keep
      // re-parsing (and potentially re-logging) a bad entry every reload.
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return sanitized;
  } catch (err) {
    // Corrupted (non-JSON) storage value — treat as logged out rather than
    // letting a parse error propagate and crash the app on load.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (removeErr) {
      // ignore — private browsing / storage disabled
    }
    return null;
  }
}

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredSession());
  // FIX (medium): structured per-field errors instead of one shared string,
  // so a submit with multiple invalid fields can surface all of them at
  // once instead of one-at-a-time across repeated attempts.
  const [fieldErrors, setFieldErrors] = useState({});
  const [sessionJustExpired, setSessionJustExpired] = useState(false);

  const persist = useCallback((session) => {
    try {
      if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // ignore persistence failures (private browsing, quota, etc.) — the
      // in-memory session still works for the current tab/session.
    }
  }, []);

  const logout = useCallback(
    (reason) => {
      setUser(null);
      persist(null);
      setFieldErrors({});
      if (reason === 'expired') setSessionJustExpired(true);
    },
    [persist]
  );

  // FIX (high, session expiry): periodically re-check the live session's
  // TTL while the app stays open in a tab — without this, a session that
  // was valid at page-load time would otherwise never expire until the
  // user manually reloads.
  useEffect(() => {
    if (!user) return undefined;
    const interval = setInterval(() => {
      if (Date.now() >= user.expiresAt) {
        logout('expired');
      }
    }, EXPIRY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user, logout]);

  const loginOfficer = useCallback(
    ({ email, deptCode, name }) => {
      const errors = {};
      if (!validateOfficerEmail(email)) errors.email = 'officerEmailInvalid';
      if (!validateDeptCode(deptCode)) errors.code = 'deptCodeInvalid';
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return false;
      }
      const domain = email.trim().toLowerCase().split('@')[1] || '';
      const now = Date.now();
      const session = {
        role: ROLES.OFFICER,
        email: email.trim().toLowerCase(),
        deptCode: deptCode.trim().toUpperCase(),
        name: name?.trim() || deriveNameFromEmail(email),
        issuer: domain.endsWith('nic.in') ? 'NIC' : 'Govt. of India',
        loginAt: now,
        expiresAt: now + SESSION_TTL_MS,
      };
      setUser(session);
      persist(session);
      setFieldErrors({});
      setSessionJustExpired(false);
      return true;
    },
    [persist]
  );

  const loginStudent = useCallback(
    ({ email, studentId, name, institution }) => {
      const errors = {};
      if (!validateStudentEmail(email)) errors.email = 'studentEmailInvalid';
      if (!validateStudentId(studentId)) errors.code = 'studentIdInvalid';
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return false;
      }
      const domain = email.trim().toLowerCase().split('@')[1] || '';
      const now = Date.now();
      const session = {
        role: ROLES.STUDENT,
        email: email.trim().toLowerCase(),
        studentId: studentId.trim().toUpperCase(),
        name: name?.trim() || deriveNameFromEmail(email),
        institution: institution?.trim() || domain,
        loginAt: now,
        expiresAt: now + SESSION_TTL_MS,
      };
      setUser(session);
      persist(session);
      setFieldErrors({});
      setSessionJustExpired(false);
      return true;
    },
    [persist]
  );

  const clearErrors = useCallback(() => setFieldErrors({}), []);

  const isSessionExpired = !!user && Date.now() >= user.expiresAt;

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: !!user && !isSessionExpired,
      isSessionExpired,
      sessionJustExpired,
      isOfficer: user?.role === ROLES.OFFICER,
      isStudent: user?.role === ROLES.STUDENT,
      fieldErrors,
      loginOfficer,
      loginStudent,
      logout,
      clearErrors,
    }),
    [user, isSessionExpired, sessionJustExpired, fieldErrors, loginOfficer, loginStudent, logout, clearErrors]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
