import { useEffect, useRef, useState, useCallback } from 'react';
import { telemetryEngine } from '../services/telemetryService.js';

/**
 * Geo-Farm — useTelemetryStream hook
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Subscribes a component to the live shared-node sensor simulation.
 *
 * Usage:
 *   const { reading, history, nodes } = useTelemetryStream('NODE-NSK-01');
 *   const { readingsByNode, nodes } = useTelemetryStream('*');
 *
 * BUGFIX (A1): Lazy initializers now call getLatestOrSnapshot() /
 * getAllLatestOrSnapshots() instead of forcing a fresh tick() on every
 * mount. Previously, each independent consumer of the wildcard stream
 * (Dashboard overview grid, GISMap, useAutoAlertMonitor) forced its own
 * simulation tick on mount, so the "real-time" clock advanced faster the
 * more panels were open simultaneously — corrupting leaf-wetness
 * accumulation and temperature smoothing history.
 *
 * BUGFIX (A2): Switching `nodeId` (e.g. via the node selector) used to
 * leave the previous node's reading displayed — mislabeled under the new
 * node's name — until the next broadcast tick arrived (up to one full
 * interval later). We now fetch immediately when nodeId changes.
 */
export function useTelemetryStream(nodeId = '*', { historyLength = 20 } = {}) {
  const [reading, setReading] = useState(() =>
    nodeId !== '*' ? telemetryEngine.getLatestOrSnapshot(nodeId) : null
  );
  const [readingsByNode, setReadingsByNode] = useState(() => {
    const map = {};
    if (nodeId === '*') {
      telemetryEngine.getAllLatestOrSnapshots().forEach((r) => {
        if (r) map[r.nodeId] = r;
      });
    }
    return map;
  });
  const historyRef = useRef([]);
  const [history, setHistory] = useState([]);
  const [nodes] = useState(() => telemetryEngine.listNodes());

  const handleUpdate = useCallback(
    (newReading) => {
      if (!newReading) return;

      if (nodeId === '*') {
        setReadingsByNode((prev) => ({ ...prev, [newReading.nodeId]: newReading }));
        return;
      }

      setReading(newReading);
      historyRef.current = [...historyRef.current, newReading].slice(-historyLength);
      setHistory(historyRef.current);
    },
    [nodeId, historyLength]
  );

  // BUGFIX (A2): fetch the selected node's current state immediately on
  // switch, rather than waiting for the next background broadcast tick.
  useEffect(() => {
    if (nodeId === '*') return;
    const immediate = telemetryEngine.getLatestOrSnapshot(nodeId);
    if (immediate) {
      setReading(immediate);
      historyRef.current = [immediate];
      setHistory(historyRef.current);
    }
  }, [nodeId]);

  useEffect(() => {
    const unsubscribe = telemetryEngine.subscribe(nodeId, handleUpdate);
    return unsubscribe;
  }, [nodeId, handleUpdate]);

  return { reading, readingsByNode, history, nodes };
}

export default useTelemetryStream;
