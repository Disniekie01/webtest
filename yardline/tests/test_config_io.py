import unittest

from yardline.config_io import deep_merge, setup_snapshot


class ConfigIoTests(unittest.TestCase):
    def test_deep_merge_nested(self):
        base = {"detector": {"weights": "a.pt", "conf": 0.2}, "tracker": {"max_age": 10}}
        overlay = {"detector": {"weights": "b.engine"}}
        out = deep_merge(base, overlay)
        self.assertEqual(out["detector"]["weights"], "b.engine")
        self.assertEqual(out["detector"]["conf"], 0.2)
        self.assertEqual(out["tracker"]["max_age"], 10)

    def test_setup_snapshot_has_roadmap(self):
        snap = setup_snapshot(
            {
                "detector": {"weights": "weights/yolov8n.engine", "conf": 0.18, "iou": 0.5, "imgsz": 960},
                "classes": {},
                "tracker": {},
                "risk": {},
                "stream": {},
                "privacy": {},
            },
            device="cuda:0",
            gpu="test",
        )
        self.assertEqual(snap["device"], "cuda:0")
        self.assertTrue(any(r["id"] == "tensorrt" for r in snap["roadmap"]))


if __name__ == "__main__":
    unittest.main()
