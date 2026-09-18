import unittest

import numpy as np

from yardline.privacy import head_region, pixelate


class TestPrivacy(unittest.TestCase):
    def test_head_is_upper_portion(self):
        x1, y1, x2, y2 = head_region(0, 0, 100, 200)
        self.assertLess(y2, 70)
        self.assertLess(x2 - x1, 100)
        self.assertGreater(y2 - y1, 20)
        cx1, cy1, cx2, cy2 = head_region(0, 0, 100, 200, frame_h=220)
        self.assertLess(cx2 - cx1, x2 - x1)
        self.assertLess(cy2 - cy1, y2 - y1)

    def test_pixelate_lowers_detail(self):
        rng = np.random.default_rng(0)
        frame = rng.integers(0, 255, (80, 80, 3), dtype=np.uint8)
        before = frame[10:50, 10:50].astype(np.float32).std()
        pixelate(frame, (10, 10, 50, 50), block=12)
        after = frame[10:50, 10:50].astype(np.float32).std()
        self.assertLess(after, before)
