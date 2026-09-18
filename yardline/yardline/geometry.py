from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class GroundPlane:
    """Planar homography from image pixels (u, v) to metric ground (x, y)."""

    H: np.ndarray
    image_points: list[list[float]]
    world_points: list[list[float]]
    rms_px: float

    def image_to_world(self, uv: np.ndarray) -> np.ndarray:
        pts = np.asarray(uv, dtype=np.float64).reshape(-1, 2)
        if len(pts) == 0:
            return np.empty((0, 2), dtype=np.float64)
        homog = np.hstack([pts, np.ones((len(pts), 1))])
        mapped = (self.H @ homog.T).T
        w = np.where(np.abs(mapped[:, 2:3]) < 1e-8, 1e-8, mapped[:, 2:3])
        return mapped[:, :2] / w

    def world_to_image(self, xy: np.ndarray) -> np.ndarray:
        H_inv = np.linalg.inv(self.H)
        pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
        if len(pts) == 0:
            return np.empty((0, 2), dtype=np.float64)
        homog = np.hstack([pts, np.ones((len(pts), 1))])
        mapped = (H_inv @ homog.T).T
        w = mapped[:, 2:3]
        w = np.where(np.abs(w) < 1e-8, 1e-8, w)
        return mapped[:, :2] / w

    def to_dict(self) -> dict:
        return {
            "H": self.H.tolist(),
            "image_points": self.image_points,
            "world_points": self.world_points,
            "rms_px": self.rms_px,
        }

    @classmethod
    def from_dict(cls, data: dict) -> GroundPlane:
        return cls(
            H=np.array(data["H"], dtype=np.float64),
            image_points=data["image_points"],
            world_points=data["world_points"],
            rms_px=float(data.get("rms_px", 0.0)),
        )


def blend_ground(
    x0: float | None,
    y0: float | None,
    vx: float,
    vy: float,
    x: float,
    y: float,
    dt: float,
    *,
    alpha: float = 0.32,
    beta: float = 0.22,
    max_speed_mps: float = 12.0,
) -> tuple[float, float, float, float]:
    """Smooth a homography sample. Gate spikes from bbox jitter near the horizon."""
    if not np.isfinite(x) or not np.isfinite(y) or abs(x) > 250 or abs(y) > 250:
        if x0 is None or y0 is None:
            return 0.0, 0.0, 0.0, 0.0
        return float(x0), float(y0), float(vx), float(vy)
    if x0 is None or y0 is None or dt <= 1e-3:
        return float(x), float(y), 0.0, 0.0
    step = float(np.hypot(x - x0, y - y0))
    max_step = max(1.6, max_speed_mps * dt)
    if step > max_step:
        return float(x0 + vx * dt), float(y0 + vy * dt), float(vx), float(vy)
    nx = (1.0 - alpha) * x0 + alpha * x
    ny = (1.0 - alpha) * y0 + alpha * y
    inst_vx = (nx - x0) / dt
    inst_vy = (ny - y0) / dt
    nvx = (1.0 - beta) * vx + beta * inst_vx
    nvy = (1.0 - beta) * vy + beta * inst_vy
    return float(nx), float(ny), float(nvx), float(nvy)


def same_hemisphere(ax: float, ay: float, bx: float, by: float) -> tuple[float, float]:
    if ax * bx + ay * by < 0:
        return -ax, -ay
    return ax, ay


def principal_axis(points_xy: np.ndarray) -> tuple[float, float]:
    pts = np.asarray(points_xy, dtype=np.float64).reshape(-1, 2)
    if len(pts) < 2:
        return 1.0, 0.0
    pts = pts - pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts, full_matrices=False)
    ax, ay = float(vt[0, 0]), float(vt[0, 1])
    mag = float(np.hypot(ax, ay)) or 1.0
    return ax / mag, ay / mag


def bbox_corners(bbox: np.ndarray) -> np.ndarray:
    x1, y1, x2, y2 = (float(v) for v in bbox)
    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float64)


def ground_box_size(
    plane: GroundPlane,
    bbox: np.ndarray,
    hx: float,
    hy: float,
    *,
    aspect: float = 2.35,
    min_len: float = 1.6,
    max_len: float = 5.8,
    min_wid: float = 0.9,
    max_wid: float = 2.4,
) -> tuple[float, float]:
    """Length/width on the plane from the bbox bottom edge. Do not project the roof."""
    x1, _, x2, y2 = (float(v) for v in bbox)
    pts = plane.image_to_world(np.array([[x1, y2], [x2, y2]], dtype=np.float64))
    if pts.shape[0] < 2 or not np.all(np.isfinite(pts)):
        return min_len, min_wid
    edge = pts[1] - pts[0]
    span = float(np.hypot(edge[0], edge[1]))
    if span < 0.12 or span > 40.0:
        return min_len, min_wid
    hn = float(np.hypot(hx, hy)) or 1.0
    fx, fy = hx / hn, hy / hn
    along = abs(float(edge[0] * fx + edge[1] * fy))
    across = abs(float(edge[0] * (-fy) + edge[1] * fx))
    if along >= across:
        length, width = span, span / aspect
    else:
        width, length = span, span * aspect
    return (
        float(np.clip(length, min_len, max_len)),
        float(np.clip(width, min_wid, max_wid)),
    )


def scale_plane(plane: GroundPlane, scale: float) -> GroundPlane:
    """Rebuild the homography with larger world metres on the same image quad."""
    s = float(scale)
    world = [[float(p[0]) * s, float(p[1]) * s] for p in plane.world_points]
    out = calibrate(plane.image_points, world)
    out.rms_px = plane.rms_px
    return out


def vehicle_width_scale(plane: GroundPlane, bbox: np.ndarray) -> float | None:
    """Scale that makes a vehicle bbox land near a real car (width ~1.85 m or length ~4.1 m)."""
    x1, y1, x2, y2 = (float(v) for v in bbox)
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    if bh < 32.0:
        return None
    pts = plane.image_to_world(np.array([[x1, y2], [x2, y2]], dtype=np.float64))
    if pts.shape[0] < 2 or not np.all(np.isfinite(pts)):
        return None
    span = float(np.hypot(pts[1, 0] - pts[0, 0], pts[1, 1] - pts[0, 1]))
    if span < 0.18 or span > 8.0:
        return None
    expected = 4.1 if bw > 1.25 * bh else 1.85
    return float(np.clip(expected / span, 1.2, 10.0))


def update_heading(
    hx: float,
    hy: float,
    vx: float,
    vy: float,
    reverse_hits: int = 0,
    *,
    min_speed: float = 1.2,
    mix: float = 0.12,
    reverse_need: int = 10,
    ready: bool = True,
) -> tuple[float, float, int]:
    """Keep a stable unit heading. Ignore slow jitter and one-frame 180° flips."""
    speed = float(np.hypot(vx, vy))
    old_n = float(np.hypot(hx, hy))
    ox, oy = (1.0, 0.0) if old_n < 1e-6 else (hx / old_n, hy / old_n)
    if speed < min_speed:
        return ox, oy, 0
    cx, cy = vx / speed, vy / speed
    if not ready:
        return cx, cy, 0
    if ox * cx + oy * cy < -0.15:
        reverse_hits += 1
        if reverse_hits < reverse_need:
            return ox, oy, reverse_hits
        reverse_hits = 0
    else:
        reverse_hits = 0
    nx = (1.0 - mix) * ox + mix * cx
    ny = (1.0 - mix) * oy + mix * cy
    mag = float(np.hypot(nx, ny)) or 1.0
    return nx / mag, ny / mag, reverse_hits


def camera_matrix(width: int, height: int) -> np.ndarray:
    fx = 0.92 * float(max(width, height))
    return np.array(
        [[fx, 0.0, width * 0.5], [0.0, fx, height * 0.5], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def project_cam(K: np.ndarray, R: np.ndarray, t: np.ndarray, xyz: np.ndarray) -> np.ndarray | None:
    p = K @ (R @ np.asarray(xyz, dtype=np.float64).reshape(3) + t.reshape(3))
    if abs(float(p[2])) < 1e-5:
        return None
    return np.array([float(p[0] / p[2]), float(p[1] / p[2])], dtype=np.float64)


def fov_world_polygon(plane: GroundPlane, width: int, height: int) -> list[list[float]]:
    """Approximate camera FOV footprint on the ground (bottom + mid image edges)."""
    w = float(max(8, width))
    h = float(max(8, height))
    samples: list[list[float]] = []
    for u in np.linspace(0.0, w, 12):
        samples.append([float(u), h - 1.0])
    for v in np.linspace(h - 1.0, h * 0.42, 7):
        samples.append([1.0, float(v)])
        samples.append([w - 1.0, float(v)])
    world = plane.image_to_world(np.asarray(samples, dtype=np.float64))
    if world.shape[0] == 0:
        return []
    # Keep points near the calibrated pad so horizon explosions don't dominate.
    pad = np.asarray(plane.world_points, dtype=np.float64)
    cx, cy = float(pad[:, 0].mean()), float(pad[:, 1].mean())
    span = float(max(np.ptp(pad[:, 0]), np.ptp(pad[:, 1]), 8.0))
    limit = span * 3.5
    kept = []
    for x, y in world:
        if not np.isfinite(x) or not np.isfinite(y):
            continue
        if abs(x - cx) > limit or abs(y - cy) > limit:
            continue
        kept.append([round(float(x), 2), round(float(y), 2)])
    if len(kept) < 3:
        return [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in pad.tolist()]
    # Order as a ring via angle about centroid.
    arr = np.asarray(kept, dtype=np.float64)
    mid = arr.mean(axis=0)
    ang = np.arctan2(arr[:, 1] - mid[1], arr[:, 0] - mid[0])
    order = np.argsort(ang)
    ring = arr[order].tolist()
    return [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in ring]


def camera_pose_from_plane(plane: GroundPlane, width: int, height: int) -> dict | None:
    """Recover a pinhole pose from the ground homography so 3D can match the camera."""
    if width < 8 or height < 8:
        return None
    try:
        G = np.linalg.inv(plane.H)
    except np.linalg.LinAlgError:
        return None
    G = G / G[2, 2]
    K = camera_matrix(width, height)
    try:
        nsol, Rs, ts, _ns = cv2.decomposeHomographyMat(G.astype(np.float64), K)
    except cv2.error:
        return None
    mid = np.mean(np.asarray(plane.world_points, dtype=np.float64), axis=0)
    best = None
    best_score = -1e18
    for i in range(int(nsol)):
        R = np.asarray(Rs[i], dtype=np.float64)
        tvec = np.asarray(ts[i], dtype=np.float64).reshape(3)
        eye = -R.T @ tvec
        if not np.all(np.isfinite(eye)) or eye[2] < 1.0 or eye[2] > 180.0:
            continue
        cam_mid = R @ np.array([mid[0], mid[1], 0.0], dtype=np.float64) + tvec
        if cam_mid[2] <= 0.4:
            continue
        look_down = float(-R[2, 2])
        score = float(eye[2]) + 12.0 * max(0.0, look_down) + min(40.0, float(cam_mid[2]))
        if score > best_score:
            best_score = score
            best = (R, tvec, eye)
    if best is None:
        return None
    R, tvec, eye = best
    return {
        "K": K.round(4).tolist(),
        "R": R.round(6).tolist(),
        "t": [round(float(v), 4) for v in tvec],
        "eye": [round(float(v), 3) for v in eye],
    }


def apparent_height_m(
    pose: dict,
    x: float,
    y: float,
    bbox: np.ndarray,
    nominal: float = 1.7,
) -> float:
    K = np.asarray(pose["K"], dtype=np.float64)
    R = np.asarray(pose["R"], dtype=np.float64)
    tvec = np.asarray(pose["t"], dtype=np.float64)
    foot = project_cam(K, R, tvec, [x, y, 0.0])
    head = project_cam(K, R, tvec, [x, y, nominal])
    if foot is None or head is None:
        return nominal
    pred = float(np.hypot(head[0] - foot[0], head[1] - foot[1]))
    obs = float(bbox[3] - bbox[1])
    if pred < 4.0 or obs < 8.0:
        return nominal
    return float(np.clip(nominal * (obs / pred), 0.45, 2.05))


def calibrate(image_points: list[list[float]], world_points: list[list[float]]) -> GroundPlane:
    src = np.array(image_points, dtype=np.float64)
    dst = np.array(world_points, dtype=np.float64)
    if src.shape[0] < 4 or dst.shape[0] < 4:
        raise ValueError("Need at least 4 point pairs to estimate a homography.")
    H, _ = cv2.findHomography(src, dst, method=0)
    if H is None:
        raise ValueError("Homography estimation failed. Check that points are not collinear.")
    plane = GroundPlane(
        H=H,
        image_points=[list(map(float, p)) for p in src],
        world_points=[list(map(float, p)) for p in dst],
        rms_px=0.0,
    )
    reproj = plane.world_to_image(dst)
    rms = float(np.sqrt(np.mean(np.sum((reproj - src) ** 2, axis=1))))
    plane.rms_px = rms
    return plane
