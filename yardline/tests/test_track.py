import unittest

import numpy as np

from yardline.detect import Detection
from yardline.track import ByteTracker, IoUTracker, build_tracker


def _det(name: str, conf: float, x1: float, y1: float, x2: float, y2: float) -> Detection:
    return Detection(name, conf, x1, y1, x2, y2)


class ByteTrackTests(unittest.TestCase):
    def test_build_default_bytetrack(self):
        trk = build_tracker({"tracker": {"backend": "bytetrack"}, "classes": {"worker": {"conf": 0.3}}})
        self.assertEqual(trk.backend, "bytetrack")
        self.assertAlmostEqual(trk.score_floor(), 0.1)

    def test_build_iou(self):
        trk = build_tracker({"tracker": {"backend": "iou"}, "classes": {}})
        self.assertEqual(trk.backend, "iou")
        self.assertIsNone(trk.score_floor())

    def test_low_score_rescues_occlusion(self):
        tracker = ByteTracker(
            high_thresh=0.4,
            low_thresh=0.1,
            match_thresh=0.5,
            second_match=0.4,
            max_age=10,
            min_hits=1,
            class_high={"worker": 0.4},
        )
        # Frame 1: strong person detection
        out = tracker.step([_det("worker", 0.9, 100, 100, 140, 220)], dt=0.04)
        self.assertEqual(len(out), 1)
        tid = out[0].track_id
        # Frame 2: only a weak overlapping box (occlusion / blur)
        out = tracker.step([_det("worker", 0.18, 108, 105, 148, 225)], dt=0.04)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].track_id, tid)

    def test_low_score_does_not_spawn_new_id(self):
        tracker = ByteTracker(high_thresh=0.4, low_thresh=0.1, min_hits=1, class_high={"worker": 0.4})
        tracker.step([_det("worker", 0.15, 10, 10, 40, 80)], dt=0.04)
        self.assertEqual(len(tracker.tracks), 0)

    def test_class_aware_no_cross_match(self):
        tracker = ByteTracker(high_thresh=0.2, low_thresh=0.1, min_hits=1, match_thresh=0.3)
        tracker.step([_det("worker", 0.9, 100, 100, 140, 220)], dt=0.04)
        out = tracker.step([_det("vehicle", 0.9, 100, 100, 140, 220)], dt=0.04)
        ids = {t.class_name: t.track_id for t in out}
        self.assertIn("worker", ids)
        self.assertIn("vehicle", ids)
        self.assertNotEqual(ids["worker"], ids["vehicle"])


if __name__ == "__main__":
    unittest.main()
