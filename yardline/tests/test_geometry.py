import unittest

from yardline.geometry import (
    blend_ground,
    calibrate,
    camera_pose_from_plane,
    ground_box_size,
    principal_axis,
    same_hemisphere,
    scale_plane,
    update_heading,
    vehicle_width_scale,
)


class TestHomography(unittest.TestCase):
    def test_square_mapping(self):
        img = [[0, 0], [100, 0], [100, 50], [0, 50]]
        world = [[0, 0], [10, 0], [10, 5], [0, 5]]
        plane = calibrate(img, world)
        mapped = plane.image_to_world([[50, 25]])[0]
        self.assertAlmostEqual(mapped[0], 5.0, delta=0.05)
        self.assertAlmostEqual(mapped[1], 2.5, delta=0.05)
        self.assertLess(plane.rms_px, 0.5)

    def test_blend_gates_horizon_spike(self):
        x, y, vx, vy = blend_ground(2.0, 3.0, 0.1, 0.0, 80.0, 3.0, 0.05)
        self.assertLess(abs(x - 2.0), 0.2)
        self.assertLess(abs(y - 3.0), 0.2)
        self.assertLess(abs(vx), 0.2)

    def test_heading_ignores_slow_jitter(self):
        hx, hy, rev = update_heading(1.0, 0.0, 0.2, 0.4, min_speed=1.2)
        self.assertAlmostEqual(hx, 1.0, delta=0.01)
        self.assertAlmostEqual(hy, 0.0, delta=0.01)
        self.assertEqual(rev, 0)

    def test_heading_locks_first_motion_even_if_opposite(self):
        hx, hy, rev = update_heading(1.0, 0.0, -3.0, 0.0, ready=False, min_speed=0.5)
        self.assertLess(hx, -0.9)
        self.assertEqual(rev, 0)

    def test_heading_rejects_one_frame_reversal(self):
        hx, hy, rev = update_heading(1.0, 0.0, -4.0, 0.1, reverse_hits=0, reverse_need=10)
        self.assertGreater(hx, 0.9)
        self.assertEqual(rev, 1)

    def test_principal_axis_follows_long_side(self):
        ax, ay = principal_axis([[0, 0], [4, 0], [4, 0.4], [0, 0.4]])
        ax, ay = same_hemisphere(ax, ay, 1.0, 0.0)
        self.assertGreater(abs(ax), abs(ay))

    def test_ground_box_size_uses_bottom_edge(self):
        img = [[0, 100], [100, 100], [100, 0], [0, 0]]
        world = [[0, 0], [10, 0], [10, 10], [0, 10]]
        plane = calibrate(img, world)
        length, width = ground_box_size(plane, [20, 40, 80, 100], 1.0, 0.0)
        self.assertGreater(length, width)
        self.assertGreater(length, 4.0)
        self.assertLess(length, 8.0)

    def test_camera_pose_is_above_the_pad(self):
        img = [[10, 90], [90, 90], [70, 30], [30, 30]]
        world = [[0, 0], [10, 0], [10, 8], [0, 8]]
        plane = calibrate(img, world)
        pose = camera_pose_from_plane(plane, 100, 100)
        self.assertIsNotNone(pose)
        self.assertGreater(pose["eye"][2], 1.0)

    def test_scale_plane_multiplies_world(self):
        img = [[0, 100], [100, 100], [100, 0], [0, 0]]
        world = [[0, 0], [10, 0], [10, 10], [0, 10]]
        plane = calibrate(img, world)
        scaled = scale_plane(plane, 4.0)
        mapped = scaled.image_to_world([[50, 50]])[0]
        self.assertAlmostEqual(mapped[0], 20.0, delta=0.2)
        self.assertAlmostEqual(mapped[1], 20.0, delta=0.2)

    def test_blend_follows_slow_motion(self):
        x, y = 0.0, 0.0
        vx, vy = 0.0, 0.0
        for i in range(12):
            x, y, vx, vy = blend_ground(x, y, vx, vy, 0.05 * (i + 1), 0.0, 0.05)
        self.assertGreater(x, 0.2)
        self.assertLess(x, 0.7)
        self.assertAlmostEqual(y, 0.0, delta=0.05)
