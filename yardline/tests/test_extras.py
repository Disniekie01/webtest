import unittest

from yardline.heatmap import OccupancyHeatmap
from yardline.reports import build_shift_report, report_to_csv
from yardline.stream_presets import suggest_for_source
from yardline.track import Track
import numpy as np


class TestExtras(unittest.TestCase):
    def test_heatmap_window_mode(self):
        hm = OccupancyHeatmap(cell_m=1.0, max_cells=20)
        hm.set_window(30)
        self.assertEqual(hm.window_s, 30)
        t = Track(1, "worker", np.array([0, 0, 10, 10], dtype=float), 0.9)
        t.confirmed = True
        t.x_m, t.y_m = 2.0, 2.0
        hm.step([t])
        pkt = hm.to_packet(threshold=0.01)
        self.assertEqual(pkt["window_s"], 30)
        hm.reset()
        self.assertEqual(len(hm._events), 0)

    def test_stream_preset_suggest(self):
        s = suggest_for_source("https://www.youtube.com/watch?v=zMCea32gpmg")
        self.assertIsNotNone(s)
        self.assertEqual(s["id"], "abbey_road")

    def test_report_csv(self):
        report = build_shift_report(limit_incidents=5, limit_labels=5)
        csv_text = report_to_csv(report)
        self.assertIn("incident_id", csv_text)
        self.assertIn("generated_at", csv_text)

    def test_sticky_class_votes(self):
        from yardline.detect import Detection
        from yardline.track import _update_track

        trk = Track(1, "worker", np.array([0, 0, 20, 40], dtype=float), 0.9)
        trk.confirmed = True
        trk.sticky_class = "worker"
        trk.class_votes = {"worker": 5}
        det = Detection("vehicle", 0.5, 0, 0, 20, 40)
        _update_track(trk, det, np.array([0, 0, 20, 40], dtype=float), 0.04, 2)
        self.assertEqual(trk.class_name, "worker")


if __name__ == "__main__":
    unittest.main()
