import unittest

from yardline.detect import Detection, geometry_ok, nms_keep


class TestMachineNMS(unittest.TestCase):
    def test_merges_overlapping_vehicle_aliases(self):
        truck = Detection("machine", 0.33, 480, 0, 873, 534)
        boat = Detection("machine", 0.30, 468, 0, 870, 529)
        far = Detection("machine", 0.28, 1048, 126, 1279, 317)
        kept = nms_keep([truck, boat, far], iou_thresh=0.25)
        self.assertEqual(len(kept), 2)
        large = max(kept, key=lambda d: d.area)
        self.assertGreater(large.area, 150_000)
        self.assertTrue(any(d.x1 > 900 for d in kept))

    def test_skyline_strip_is_not_the_plant(self):
        strip = Detection("machine", 0.36, 378, 5, 500, 44)
        self.assertFalse(
            geometry_ok(
                strip,
                1280,
                720,
                min_area_frac=0.012,
                min_height_frac=0.10,
                min_foot_frac=0.22,
                max_aspect=3.5,
            )
        )

    def test_street_car_passes_vehicle_gates(self):
        car = Detection("vehicle", 0.62, 520, 390, 680, 470)
        self.assertTrue(
            geometry_ok(
                car,
                1280,
                720,
                min_area_frac=0.0008,
                min_height_frac=0.04,
                min_foot_frac=0.14,
                max_aspect=4.8,
            )
        )

    def test_distant_city_car_still_passes(self):
        car = Detection("vehicle", 0.40, 900, 410, 960, 445)
        self.assertTrue(
            geometry_ok(
                car,
                1280,
                720,
                min_area_frac=0.0008,
                min_height_frac=0.04,
                min_foot_frac=0.14,
                max_aspect=4.8,
            )
        )

    def test_horizon_speck_is_dropped(self):
        speck = Detection("vehicle", 0.45, 420, 80, 464, 100)
        self.assertFalse(
            geometry_ok(
                speck,
                960,
                540,
                min_area_frac=0.0008,
                min_height_frac=0.04,
                min_foot_frac=0.14,
                max_aspect=4.8,
            )
        )

    def test_keeps_separated_boxes(self):
        a = Detection("machine", 0.4, 0, 0, 100, 100)
        b = Detection("machine", 0.4, 400, 0, 500, 100)
        kept = nms_keep([a, b], iou_thresh=0.25)
        self.assertEqual(len(kept), 2)
