import unittest

import numpy as np

from yardline import dataset as trainset


class DatasetTests(unittest.TestCase):
    def test_yolo_roundtrip(self):
        trainset.ensure_layout()
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        frame[:] = (40, 40, 40)
        sample = trainset.capture_frame(
            frame,
            source="unit",
            frame_index=1,
            seed_boxes=[{"class_name": "worker", "bbox": [20, 30, 60, 120], "conf": 0.9}],
        )
        self.assertEqual(sample["n_boxes"], 1)
        self.assertEqual(sample["boxes"][0]["class_name"], "person")
        saved = trainset.save_sample(
            sample["id"],
            [
                {"class_name": "vehicle", "bbox": [100, 80, 180, 140]},
                {"class_name": "robot", "bbox": [200, 100, 250, 160]},
            ],
        )
        self.assertEqual(saved["n_boxes"], 2)
        names = {b["class_name"] for b in saved["boxes"]}
        self.assertEqual(names, {"vehicle", "robot"})
        trainset.delete_sample(sample["id"])


if __name__ == "__main__":
    unittest.main()
