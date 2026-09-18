import unittest

import numpy as np

from yardline.risk import RiskEngine, constant_velocity_ttc
from yardline.track import Track


class TestTTC(unittest.TestCase):
    def test_head_on_overlap(self):
        ttc, closing = constant_velocity_ttc(
            ax=0.0, ay=0.0, avx=1.0, avy=0.0, ar=0.5,
            bx=5.0, by=0.0, bvx=-1.0, bvy=0.0, br=0.5,
            horizon_s=5.0, dt_s=0.1,
        )
        self.assertTrue(closing)
        self.assertIsNotNone(ttc)
        self.assertAlmostEqual(ttc, 2.0, delta=0.15)

    def test_proximity_alarms_stationary(self):
        engine = RiskEngine(
            {
                "risk": {
                    "horizon_s": 5.0,
                    "dt_s": 0.1,
                    "warning_ttc_s": 2.5,
                    "critical_ttc_s": 1.2,
                    "advisory_distance_m": 4.0,
                    "warning_distance_m": 2.0,
                    "critical_distance_m": 0.5,
                    "escalate_frames": 1,
                    "clear_frames": 1,
                }
            },
            {"worker": 0.45, "vehicle": 1.4},
        )
        person = Track(1, "worker", np.array([0, 0, 10, 10], dtype=float), 0.9)
        person.confirmed = True
        person.x_m, person.y_m = 0.0, 0.0
        car = Track(2, "vehicle", np.array([20, 0, 40, 20], dtype=float), 0.8)
        car.confirmed = True
        # center distance 2.5 m → clearance 2.5 - 0.45 - 1.4 = 0.65 m → warning
        car.x_m, car.y_m = 2.5, 0.0
        out = engine.evaluate([person, car])
        self.assertEqual(out["alarm"], "warning")
        self.assertAlmostEqual(out["min_clearance_m"], 0.65, places=2)
        self.assertIsNone(out["min_ttc_s"])

    def test_pair_payload_names_classes(self):
        engine = RiskEngine(
            {
                "risk": {
                    "horizon_s": 5.0,
                    "dt_s": 0.1,
                    "warning_ttc_s": 2.5,
                    "critical_ttc_s": 1.2,
                    "advisory_distance_m": 4.0,
                    "warning_distance_m": 2.0,
                    "critical_distance_m": 0.5,
                    "escalate_frames": 1,
                    "clear_frames": 1,
                }
            },
            {"worker": 0.45, "vehicle": 1.4},
        )
        person = Track(1, "worker", np.array([0, 0, 10, 10], dtype=float), 0.9)
        person.confirmed = True
        person.x_m, person.y_m = 0.0, 0.0
        person.vx_mps, person.vy_mps = 1.0, 0.0
        car = Track(2, "vehicle", np.array([20, 0, 40, 20], dtype=float), 0.8)
        car.confirmed = True
        car.x_m, car.y_m = 5.0, 0.0
        car.vx_mps, car.vy_mps = -1.0, 0.0
        out = engine.evaluate([person, car])
        self.assertEqual(out["pairs"][0]["class_a"], "worker")
        self.assertEqual(out["pairs"][0]["class_b"], "vehicle")
        self.assertIsNotNone(out["pairs"][0]["ttc_s"])

    def test_parallel_no_hit(self):
        ttc, closing = constant_velocity_ttc(
            ax=0.0, ay=0.0, avx=1.0, avy=0.0, ar=0.5,
            bx=0.0, by=8.0, bvx=1.0, bvy=0.0, br=2.0,
            horizon_s=5.0, dt_s=0.1,
        )
        self.assertFalse(closing)
        self.assertIsNone(ttc)


if __name__ == "__main__":
    unittest.main()
