import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
} from 'react';

/**
 * Geo-Farm — Alert Queue Context
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Central state store for the outbreak-alert lifecycle:
 *   AI Flagged -> Officer Audited (Verified / Rejected) -> Alert Dispatched
 *
 * Consumed by:
 *   - OfficerDashboard.jsx  (verification queue, status transitions)
 *   - AlertCenter.jsx       (dispatched alerts -> WhatsApp/SMS/IVR payloads)
 *   - GISMap.jsx            (map markers reflect current alert status/severity)
 *   - EdgeAIScanner.jsx     (pushes new AI-flagged alerts into the queue)
 *   - telemetryService / pestForecast (push threshold-breach alerts)
 */

export const ALERT_STATUS = {
  FLAGGED: 'FLAGGED', // AI Flagged — awaiting officer review
  VERIFIED: 'VERIFIED', // Officer Audited & confirmed
  REJECTED: 'REJECTED', // Officer Audited & dismissed (false positive)
  DISPATCHED: 'DISPATCHED', // Alert Dispatched to farmers
};

export const ALERT_SOURCE = {
  TELEMETRY: 'TELEMETRY', // Magarey infection-risk model (fungal disease)
  PEST_FORECAST: 'PEST_FORECAST', // Degree-day swarm forecaster
  EDGE_AI_SCAN: 'EDGE_AI_SCAN', // Leaf scanner classification
};

export const RISK_LEVEL = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  SEVERE: 'SEVERE',
  CRITICAL: 'CRITICAL',
};

// BUGFIX (B3): crypto.randomUUID() is collision-safe across hot-reloads
// and concurrent alert creation. The previous module-level counter reset
// to 0 on every Vite HMR update in dev, risking duplicate React keys
// against already-rendered alerts from before the reload.
function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `alert_${crypto.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID (older browsers).
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const initialState = {
  alerts: [], // newest first
};

function alertQueueReducer(state, action) {
  switch (action.type) {
    case 'ADD_ALERT': {
      const alert = {
        id: nextId(),
        status: ALERT_STATUS.FLAGGED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [{ status: ALERT_STATUS.FLAGGED, at: Date.now() }],
        ...action.payload,
      };
      return { ...state, alerts: [alert, ...state.alerts] };
    }

    case 'VERIFY_ALERT': {
      return {
        ...state,
        alerts: state.alerts.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                status: ALERT_STATUS.VERIFIED,
                updatedAt: Date.now(),
                verifiedBy: action.payload.officerName ?? 'Unknown Officer',
                officerNote: action.payload.note ?? '',
                history: [
                  ...a.history,
                  { status: ALERT_STATUS.VERIFIED, at: Date.now() },
                ],
              }
            : a
        ),
      };
    }

    case 'REJECT_ALERT': {
      return {
        ...state,
        alerts: state.alerts.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                status: ALERT_STATUS.REJECTED,
                updatedAt: Date.now(),
                verifiedBy: action.payload.officerName ?? 'Unknown Officer',
                officerNote: action.payload.note ?? '',
                history: [
                  ...a.history,
                  { status: ALERT_STATUS.REJECTED, at: Date.now() },
                ],
              }
            : a
        ),
      };
    }

    case 'DISPATCH_ALERT': {
      return {
        ...state,
        alerts: state.alerts.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                status: ALERT_STATUS.DISPATCHED,
                updatedAt: Date.now(),
                dispatchChannels: action.payload.channels ?? ['whatsapp', 'sms'],
                history: [
                  ...a.history,
                  { status: ALERT_STATUS.DISPATCHED, at: Date.now() },
                ],
              }
            : a
        ),
      };
    }

    case 'CLEAR_ALERTS':
      return { ...state, alerts: [] };

    default:
      return state;
  }
}

const AlertQueueContext = createContext(undefined);

export function AlertQueueProvider({ children }) {
  const [state, dispatch] = useReducer(alertQueueReducer, initialState);

  const addAlert = useCallback((payload) => {
    dispatch({ type: 'ADD_ALERT', payload });
  }, []);

  const verifyAlert = useCallback((id, officerName, note) => {
    dispatch({ type: 'VERIFY_ALERT', payload: { id, officerName, note } });
  }, []);

  const rejectAlert = useCallback((id, officerName, note) => {
    dispatch({ type: 'REJECT_ALERT', payload: { id, officerName, note } });
  }, []);

  const dispatchAlert = useCallback((id, channels) => {
    dispatch({ type: 'DISPATCH_ALERT', payload: { id, channels } });
  }, []);

  const clearAlerts = useCallback(() => {
    dispatch({ type: 'CLEAR_ALERTS' });
  }, []);

  const pendingAlerts = useMemo(
    () => state.alerts.filter((a) => a.status === ALERT_STATUS.FLAGGED),
    [state.alerts]
  );

  const verifiedAlerts = useMemo(
    () => state.alerts.filter((a) => a.status === ALERT_STATUS.VERIFIED),
    [state.alerts]
  );

  const dispatchedAlerts = useMemo(
    () => state.alerts.filter((a) => a.status === ALERT_STATUS.DISPATCHED),
    [state.alerts]
  );

  // BUGFIX (B4): previously counted DISPATCHED severe/critical alerts too,
  // so the header's pulsing "Critical" counter never went down even after
  // officers fully resolved and sent out every alert — misleading during
  // a live demo. Now only counts alerts still awaiting action (Flagged or
  // Verified-but-not-yet-dispatched).
  const criticalCount = useMemo(
    () =>
      state.alerts.filter(
        (a) =>
          (a.riskLevel === RISK_LEVEL.SEVERE || a.riskLevel === RISK_LEVEL.CRITICAL) &&
          (a.status === ALERT_STATUS.FLAGGED || a.status === ALERT_STATUS.VERIFIED)
      ).length,
    [state.alerts]
  );

  const value = useMemo(
    () => ({
      alerts: state.alerts,
      pendingAlerts,
      verifiedAlerts,
      dispatchedAlerts,
      criticalCount,
      addAlert,
      verifyAlert,
      rejectAlert,
      dispatchAlert,
      clearAlerts,
    }),
    [
      state.alerts,
      pendingAlerts,
      verifiedAlerts,
      dispatchedAlerts,
      criticalCount,
      addAlert,
      verifyAlert,
      rejectAlert,
      dispatchAlert,
      clearAlerts,
    ]
  );

  return (
    <AlertQueueContext.Provider value={value}>
      {children}
    </AlertQueueContext.Provider>
  );
}

export function useAlertQueue() {
  const ctx = useContext(AlertQueueContext);
  if (!ctx) {
    throw new Error('useAlertQueue must be used within an AlertQueueProvider');
  }
  return ctx;
}

export default AlertQueueContext;
