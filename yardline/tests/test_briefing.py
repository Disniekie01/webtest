import unittest

from yardline.briefing import build_briefing


class TestBriefing(unittest.TestCase):
    def test_empty(self):
        note = build_briefing(None, None)
        self.assertFalse(note["ok"])
        self.assertIn("Play a source", note["body"])

    def test_from_packet(self):
        packet = {
            "frame_index": 12,
            "calibrated": True,
            "tracks": [
                {"class_name": "worker", "confirmed": True},
                {"class_name": "machine", "confirmed": True},
            ],
            "risk": {
                "alarm": "warning",
                "raw_level": 2,
                "min_distance_m": 3.4,
                "min_ttc_s": 1.8,
                "method": "constant-velocity discs",
                "zone_hits": [],
                "pairs": [
                    {
                        "track_a": 1,
                        "track_b": 2,
                        "distance_m": 3.4,
                        "ttc_s": 1.8,
                        "closing": True,
                    }
                ],
            },
        }
        note = build_briefing(packet, {"path": "data/videos/demo.mp4", "frames": 100})
        self.assertTrue(note["ok"])
        self.assertIn("People tracked: 1", note["body"])
        self.assertIn("TTC 1.8 s", note["body"])
        self.assertIn("static checklist", note["body"])


if __name__ == "__main__":
    unittest.main()
