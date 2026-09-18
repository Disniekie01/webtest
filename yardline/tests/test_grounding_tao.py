import unittest

import numpy as np

from yardline import dataset as trainset
from yardline.grounding import map_prompt_to_class, parse_prompts


class GroundingMapTests(unittest.TestCase):
    def test_prompt_mapping(self):
        self.assertEqual(map_prompt_to_class("person"), "person")
        self.assertEqual(map_prompt_to_class("car"), "vehicle")
        self.assertEqual(map_prompt_to_class("truck"), "vehicle")
        self.assertEqual(map_prompt_to_class("robot"), "robot")
        self.assertEqual(map_prompt_to_class("excavator"), "robot")
        self.assertIsNone(map_prompt_to_class("banana"))

    def test_parse_prompts(self):
        self.assertEqual(parse_prompts("person, car"), ["person", "car"])
        self.assertTrue(len(parse_prompts(None)) >= 3)


class CocoExportTests(unittest.TestCase):
    def test_export_coco_shape(self):
        trainset.ensure_layout()
        stems = []
        for i in range(2):
            frame = np.zeros((120, 160, 3), dtype=np.uint8)
            frame[:] = (30 + i * 10, 30, 30)
            sample = trainset.capture_frame(
                frame,
                source=f"unit{i}",
                frame_index=i,
                seed_boxes=[{"class_name": "worker", "bbox": [10, 10, 40, 80], "conf": 0.9}],
            )
            stems.append(sample["id"])
        out = trainset.export_coco()
        self.assertGreaterEqual(out["n_images"], 2)
        self.assertGreaterEqual(out["n_annotations"], 2)
        self.assertTrue(trainset.TAO_MOUNTS_FILE.exists())
        self.assertTrue((trainset.TAO_SPECS / "rtdetr_train.yaml").exists())
        self.assertTrue((trainset.TAO_SPECS / "grounding_dino_train.yaml").exists())
        for stem in stems:
            trainset.delete_sample(stem)


if __name__ == "__main__":
    unittest.main()
