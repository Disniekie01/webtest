import { useEffect } from "react";
import {
  collectComfortDeposits,
  getComfortZoneGrid,
  publishComfortZones,
} from "../../cv/comfortZones";
import { useLabStore } from "../../state/store";

/**
 * Keeps Kit/Vite comfort-zone API fresh even when the CV modal is closed.
 */
export function ComfortZonePublisher() {
  const selectedId = useLabStore((s) => s.selectedId);
  const personPos = useLabStore((s) => s.personPos);
  const comfortOverrides = useLabStore((s) => s.comfortOverrides);

  useEffect(() => {
    const deposits = collectComfortDeposits({
      overrides: comfortOverrides,
      selectedId,
      personPos,
      optInOnly: false,
    });
    const grid = getComfortZoneGrid();
    grid.rebuild(deposits);
    const snap = grid.snapshot(deposits);
    void publishComfortZones(snap);
  }, [comfortOverrides, selectedId, personPos]);

  return null;
}
