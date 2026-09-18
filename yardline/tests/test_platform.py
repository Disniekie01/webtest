import unittest

import numpy as np

from yardline.heatmap import OccupancyHeatmap
from yardline.presets import delete_preset, list_presets, upsert_preset
from yardline.risk import RiskEngine, _normalize_zone
from yardline.track import Track


def _engine(**extra):
    risk = {
        "horizon_s": 5.0,
        "dt_s": 0.1,
        "warning_ttc_s": 2.5,
        "critical_ttc_s": 1.2,
        "advisory_distance_m": 4.0,
        "warning_distance_m": 2.0,
        "critical_distance_m": 0.5,
        "escalate_frames": 1,
        "clear_frames": 1,
        "min_hold_s": 0.0,
        "cooldown_s": 0.0,
        "zone_dwell_s": 0.0,
    }
    risk.update(extra)
    return RiskEngine({"risk": risk}, {"worker": 0.45, "vehicle": 1.4})


def _worker(tid: int, x: float, y: float, vx: float = 0.0, vy: float = 0.0) -> Track:
    t = Track(tid, "worker", np.array([0, 0, 10, 10], dtype=float), 0.9)
    t.confirmed = True
    t.x_m, t.y_m = x, y
    t.vx_mps, t.vy_mps = vx, vy
    return t


class TestPlatformRisk(unittest.TestCase):
    def test_normalize_tripwire(self):
        z = _normalize_zone({"id": "t1", "kind": "tripwire", "a": [0, 0], "b": [4, 0], "level": 1})
        self.assertEqual(z["kind"], "tripwire")
        self.assertEqual(z["a"], [0.0, 0.0])
        self.assertEqual(z["b"], [4.0, 0.0])

    def test_exclusion_zone_raises(self):
        eng = _engine()
        eng.set_zones(
            [{"id": "z1", "name": "Keep out", "kind": "exclusion", "polygon": [[0, 0], [3, 0], [3, 3], [0, 3]], "level": 2}]
        )
        out = eng.evaluate([_worker(1, 1.0, 1.0)], dt_s=0.1)
        self.assertEqual(out["alarm_level"], 2)
        self.assertEqual(len(out["zone_hits"]), 1)
        self.assertEqual(out["occupancy"]["z1"], 1)

    def test_zone_dwell_gates_alarm(self):
        eng = _engine(zone_dwell_s=1.0)
        eng.set_zones(
            [{"id": "z1", "kind": "exclusion", "polygon": [[0, 0], [2, 0], [2, 2], [0, 2]], "level": 3, "dwell_s": 1.0}]
        )
        first = eng.evaluate([_worker(1, 1.0, 1.0)], dt_s=0.2)
        self.assertEqual(first["alarm_level"], 0)
        self.assertFalse(first["zone_hits"][0]["armed"])
        for _ in range(6):
            out = eng.evaluate([_worker(1, 1.0, 1.0)], dt_s=0.2)
        self.assertGreaterEqual(out["alarm_level"], 2)
        self.assertTrue(out["zone_hits"][0]["armed"])

    def test_tripwire_crossing(self):
        eng = _engine()
        eng.set_zones([{"id": "tw", "kind": "tripwire", "a": [0, 0], "b": [0, 4], "level": 1, "name": "Gate"}])
        # Start on negative side of x=0 line (left), then cross to positive.
        eng.evaluate([_worker(1, -1.0, 2.0, vx=0.0)], dt_s=0.1)
        out = eng.evaluate([_worker(1, 1.0, 2.0, vx=20.0)], dt_s=0.1)
        self.assertEqual(out["trip_counts"].get("tw"), 1)
        self.assertEqual(len(out["trip_events"]), 1)

    def test_min_hold_blocks_instant_escalate(self):
        eng = _engine(min_hold_s=1.0, escalate_frames=1)
        car = Track(2, "vehicle", np.array([20, 0, 40, 20], dtype=float), 0.8)
        car.confirmed = True
        car.x_m, car.y_m = 2.5, 0.0  # clearance ~0.65 → warning
        out = eng.evaluate([_worker(1, 0.0, 0.0), car], dt_s=0.1)
        self.assertEqual(out["alarm_level"], 0)
        for _ in range(12):
            out = eng.evaluate([_worker(1, 0.0, 0.0), car], dt_s=0.1)
        self.assertEqual(out["alarm"], "warning")


class TestHeatmapPresets(unittest.TestCase):
    def test_heatmap_cells(self):
        hm = OccupancyHeatmap(cell_m=1.0, decay=1.0, max_cells=20)
        w = _worker(1, 5.0, 5.0)
        hm.step([w])
        hm.step([w])
        pkt = hm.to_packet(threshold=0.01)
        self.assertIsNotNone(pkt)
        self.assertGreater(len(pkt["cells"]), 0)

    def test_preset_roundtrip(self):
        row = upsert_preset({"name": "Test Cam", "source": "https://example.com/x", "note": "n"})
        self.assertTrue(row["id"])
        ids = [p["id"] for p in list_presets()]
        self.assertIn(row["id"], ids)
        self.assertTrue(delete_preset(row["id"]))


if __name__ == "__main__":
    unittest.main()
