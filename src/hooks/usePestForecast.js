import { useEffect, useRef, useState, useCallback } from 'react';
import { pestForecastEngine } from '../services/pestForecast.js';

/**
 * Geo-Farm — usePestForecast hook
 * SIH26131: Early detection & management of crop diseases and pest infestations
 *
 * Subscribes a component to the live pheromone-trap / degree-day
 * swarm-forecast simulation.
 *
 * Usage:
 *   const { reading, history, traps } = usePestForecast('TRAP-NSK-A1');
 *   const { readingsByTrap, traps } = usePestForecast('*');
 *
 * BUGFIX (A1): See useTelemetryStream.js — lazy initializers now use
 * getLatestOrSnapshot() / getAllLatestOrSnapshots() instead of forcing a
 * fresh tick() per mounted consumer.
 *
 * BUGFIX (A2): Switching `trapId` now fetches immediately instead of
 * showing the previous trap's data mislabeled until the next broadcast.
 */
export function usePestForecast(trapId = '*', { historyLength = 20 } = {}) {
  const [reading, setReading] = useState(() =>
    trapId !== '*' ? pestForecastEngine.getLatestOrSnapshot(trapId) : null
  );
  const [readingsByTrap, setReadingsByTrap] = useState(() => {
    const map = {};
    if (trapId === '*') {
      pestForecastEngine.getAllLatestOrSnapshots().forEach((r) => {
        if (r) map[r.trapId] = r;
      });
    }
    return map;
  });
  const historyRef = useRef([]);
  const [history, setHistory] = useState([]);
  const [traps] = useState(() => pestForecastEngine.listTraps());

  const handleUpdate = useCallback(
    (newReading) => {
      if (!newReading) return;

      if (trapId === '*') {
        setReadingsByTrap((prev) => ({ ...prev, [newReading.trapId]: newReading }));
        return;
      }

      setReading(newReading);
      historyRef.current = [...historyRef.current, newReading].slice(-historyLength);
      setHistory(historyRef.current);
    },
    [trapId, historyLength]
  );

  // BUGFIX (A2): fetch immediately on trap switch.
  useEffect(() => {
    if (trapId === '*') return;
    const immediate = pestForecastEngine.getLatestOrSnapshot(trapId);
    if (immediate) {
      setReading(immediate);
      historyRef.current = [immediate];
      setHistory(historyRef.current);
    }
  }, [trapId]);

  useEffect(() => {
    const unsubscribe = pestForecastEngine.subscribe(trapId, handleUpdate);
    return unsubscribe;
  }, [trapId, handleUpdate]);

  const swarmAlerts =
    trapId === '*' ? Object.values(readingsByTrap).filter((r) => r.swarmImminent) : [];

  return { reading, readingsByTrap, history, traps, swarmAlerts };
}

export default usePestForecast;
