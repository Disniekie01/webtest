from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString, Point, Polygon

from yardline.track import Track


@dataclass
class PairRisk:
    track_a: int
    track_b: int
    class_a: str
    class_b: str
    distance_m: float
    ttc_s: float | None
    closing: bool


@dataclass
class Debouncer:
    escalate_frames: int = 3
    clear_frames: int = 12
    level: int = 0
    _up: int = 0
    _down: int = 0

    def step(self, candidate: int) -> int:
        if candidate > self.level:
            self._up += 1
            self._down = 0
            if self._up >= self.escalate_frames:
                self.level = candidate
                self._up = 0
        elif candidate < self.level:
            self._down += 1
            self._up = 0
            if self._down >= self.clear_frames:
                self.level = candidate
                self._down = 0
        else:
            self._up = 0
            self._down = 0
        return self.level

    def reset(self) -> None:
        self.level = 0
        self._up = 0
        self._down = 0


LEVEL_NAME = {0: "clear", 1: "advisory", 2: "warning", 3: "critical"}
ZONE_KINDS = {"exclusion", "work", "path", "tripwire"}


def constant_velocity_ttc(
    ax: float,
    ay: float,
    avx: float,
    avy: float,
    ar: float,
    bx: float,
    by: float,
    bvx: float,
    bvy: float,
    br: float,
    horizon_s: float,
    dt_s: float,
) -> tuple[float | None, bool]:
    """First time the two discs overlap under constant velocity. None if they do not."""
    r = ar + br
    rel_x = ax - bx
    rel_y = ay - by
    rel_vx = avx - bvx
    rel_vy = avy - bvy
    closing = bool((rel_x * rel_vx + rel_y * rel_vy) < 0)
    t = 0.0
    while t <= horizon_s + 1e-9:
        dx = rel_x + rel_vx * t
        dy = rel_y + rel_vy * t
        if dx * dx + dy * dy <= r * r:
            return t, closing
        t += dt_s
    return None, closing


def _line_side(ax: float, ay: float, bx: float, by: float, x: float, y: float) -> float:
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax)


def _normalize_zone(zone: dict) -> dict:
    kind = str(zone.get("kind") or zone.get("type") or "exclusion").lower()
    if kind not in ZONE_KINDS:
        kind = "exclusion"
    out = {
        "id": zone.get("id") or "zone",
        "name": zone.get("name") or kind.title(),
        "kind": kind,
        "level": int(zone.get("level", 2 if kind == "exclusion" else 0)),
        "dwell_s": float(zone.get("dwell_s", 0.0)),
    }
    if kind == "tripwire":
        a = zone.get("a") or (zone.get("polygon") or [[0, 0]])[0]
        b = zone.get("b") or (zone.get("polygon") or [[0, 0], [1, 0]])[-1]
        out["a"] = [float(a[0]), float(a[1])]
        out["b"] = [float(b[0]), float(b[1])]
        out["polygon"] = [out["a"], out["b"]]
    else:
        poly = zone.get("polygon") or []
        out["polygon"] = [[float(p[0]), float(p[1])] for p in poly]
    return out


class RiskEngine:
    def __init__(self, cfg: dict, class_radii: dict[str, float]):
        risk = cfg["risk"]
        self.horizon_s = float(risk["horizon_s"])
        self.dt_s = float(risk["dt_s"])
        self.warning_ttc = float(risk["warning_ttc_s"])
        self.critical_ttc = float(risk["critical_ttc_s"])
        self.warning_distance_m = float(risk.get("warning_distance_m", 2.0))
        self.critical_distance_m = float(risk.get("critical_distance_m", 0.5))
        self.advisory_distance_m = float(risk.get("advisory_distance_m", 4.0))
        self.min_hold_s = float(risk.get("min_hold_s", 0.0))
        self.cooldown_s = float(risk.get("cooldown_s", 5.0))
        self.default_zone_dwell_s = float(risk.get("zone_dwell_s", 0.0))
        self.radii = class_radii
        self.debouncer = Debouncer(
            escalate_frames=int(risk["escalate_frames"]),
            clear_frames=int(risk["clear_frames"]),
        )
        self.zones: list[dict] = []
        self._dwell: dict[tuple[int, str], float] = {}
        self._trip_side: dict[tuple[int, str], float] = {}
        self._hold_level = 0
        self._hold_elapsed = 0.0
        self._cooldown_left = 0.0
        self._last_alarm = 0
        self.trip_counts: dict[str, int] = {}
        self.occupancy: dict[str, int] = {}

    def reset(self) -> None:
        self.debouncer.reset()
        self._dwell.clear()
        self._trip_side.clear()
        self._hold_level = 0
        self._hold_elapsed = 0.0
        self._cooldown_left = 0.0
        self._last_alarm = 0
        self.trip_counts = {z["id"]: self.trip_counts.get(z["id"], 0) for z in self.zones if z.get("kind") == "tripwire"}
        self.occupancy = {}

    def set_zones(self, zones: list[dict]) -> None:
        self.zones = [_normalize_zone(z) for z in zones]
        self._dwell = {k: v for k, v in self._dwell.items() if any(z["id"] == k[1] for z in self.zones)}
        self._trip_side = {k: v for k, v in self._trip_side.items() if any(z["id"] == k[1] for z in self.zones)}
        for z in self.zones:
            if z["kind"] == "tripwire" and z["id"] not in self.trip_counts:
                self.trip_counts[z["id"]] = 0

    def _edge_clearance(self, class_a: str, class_b: str, center_dist: float) -> float:
        ra = self.radii.get(class_a, 0.45)
        rb = self.radii.get(class_b, 1.4)
        return float(center_dist - ra - rb)

    def _apply_hold(self, raw_level: int, dt: float) -> int:
        if raw_level != self._hold_level:
            self._hold_level = raw_level
            self._hold_elapsed = 0.0
        else:
            self._hold_elapsed += dt
        if raw_level <= 0:
            return 0
        if self.min_hold_s <= 0 or self._hold_elapsed >= self.min_hold_s:
            return raw_level
        # Hold incomplete: keep prior alarm level for debounce input (no new escalate).
        return min(raw_level, self.debouncer.level)

    def evaluate(self, tracks: list[Track], dt_s: float | None = None) -> dict:
        dt = float(dt_s if dt_s is not None else self.dt_s)
        if self._cooldown_left > 0:
            self._cooldown_left = max(0.0, self._cooldown_left - dt)

        metric_tracks = [
            t for t in tracks if t.confirmed and t.x_m is not None and t.y_m is not None
        ]
        workers = [t for t in metric_tracks if t.class_name == "worker"]
        hazards = [t for t in metric_tracks if t.class_name in {"machine", "vehicle"}]
        pairs: list[PairRisk] = []

        for w in workers:
            for m in hazards:
                dist = float(
                    np.hypot(w.x_m - m.x_m, w.y_m - m.y_m)  # type: ignore[operator]
                )
                ttc, closing = constant_velocity_ttc(
                    w.x_m,  # type: ignore[arg-type]
                    w.y_m,  # type: ignore[arg-type]
                    w.vx_mps,
                    w.vy_mps,
                    self.radii.get("worker", 0.45),
                    m.x_m,  # type: ignore[arg-type]
                    m.y_m,  # type: ignore[arg-type]
                    m.vx_mps,
                    m.vy_mps,
                    self.radii.get(m.class_name, 2.4),
                    self.horizon_s,
                    self.dt_s,
                )
                pairs.append(
                    PairRisk(
                        track_a=w.track_id,
                        track_b=m.track_id,
                        class_a="worker",
                        class_b=m.class_name,
                        distance_m=dist,
                        ttc_s=ttc,
                        closing=closing,
                    )
                )

        raw_level = 0
        min_ttc: float | None = None
        min_dist: float | None = None
        min_clearance: float | None = None
        for p in pairs:
            clearance = self._edge_clearance(p.class_a, p.class_b, p.distance_m)
            min_dist = p.distance_m if min_dist is None else min(min_dist, p.distance_m)
            min_clearance = clearance if min_clearance is None else min(min_clearance, clearance)

            if clearance <= self.critical_distance_m:
                raw_level = max(raw_level, 3)
            elif clearance <= self.warning_distance_m:
                raw_level = max(raw_level, 2)
            elif clearance <= self.advisory_distance_m:
                raw_level = max(raw_level, 1)

            if p.ttc_s is not None:
                min_ttc = p.ttc_s if min_ttc is None else min(min_ttc, p.ttc_s)
                if p.ttc_s <= self.critical_ttc:
                    raw_level = max(raw_level, 3)
                elif p.ttc_s <= self.warning_ttc:
                    raw_level = max(raw_level, 2)
                elif p.ttc_s <= 4.0:
                    raw_level = max(raw_level, 1)

        zone_hits: list[dict] = []
        trip_events: list[dict] = []
        self.occupancy = {}
        alive_keys: set[tuple[int, str]] = set()

        polys = [z for z in self.zones if z["kind"] != "tripwire" and len(z.get("polygon") or []) >= 3]
        wires = [z for z in self.zones if z["kind"] == "tripwire"]

        for t in workers:
            pt = Point(t.x_m, t.y_m)
            for zone in polys:
                poly = Polygon(zone["polygon"])
                if not poly.contains(pt):
                    continue
                key = (t.track_id, zone["id"])
                alive_keys.add(key)
                self._dwell[key] = self._dwell.get(key, 0.0) + dt
                dwell_need = float(zone.get("dwell_s") or self.default_zone_dwell_s or 0.0)
                dwell = self._dwell[key]
                hit = {
                    "track_id": t.track_id,
                    "zone_id": zone["id"],
                    "name": zone.get("name", "Zone"),
                    "kind": zone["kind"],
                    "dwell_s": round(dwell, 2),
                    "armed": dwell >= dwell_need,
                }
                zone_hits.append(hit)
                self.occupancy[zone["id"]] = self.occupancy.get(zone["id"], 0) + 1
                if zone["kind"] == "exclusion" and dwell >= dwell_need:
                    raw_level = max(raw_level, int(zone.get("level", 2)))

            for zone in wires:
                ax, ay = zone["a"]
                bx, by = zone["b"]
                side = _line_side(ax, ay, bx, by, float(t.x_m), float(t.y_m))  # type: ignore[arg-type]
                key = (t.track_id, zone["id"])
                prev = self._trip_side.get(key)
                self._trip_side[key] = side
                if prev is None or prev == 0 or side == 0:
                    continue
                if prev * side < 0:
                    # Confirm the segment of motion crosses the wire segment.
                    line = LineString([zone["a"], zone["b"]])
                    path = LineString(
                        [
                            (float(t.x_m) - float(t.vx_mps) * dt, float(t.y_m) - float(t.vy_mps) * dt),
                            (float(t.x_m), float(t.y_m)),
                        ]
                    )
                    if not line.intersects(path):
                        continue
                    self.trip_counts[zone["id"]] = int(self.trip_counts.get(zone["id"], 0)) + 1
                    trip_events.append(
                        {
                            "track_id": t.track_id,
                            "zone_id": zone["id"],
                            "name": zone.get("name", "Tripwire"),
                            "count": self.trip_counts[zone["id"]],
                            "direction": "pos" if side > 0 else "neg",
                        }
                    )
                    raw_level = max(raw_level, int(zone.get("level", 1)))

        stale = [k for k in self._dwell if k not in alive_keys]
        for k in stale:
            del self._dwell[k]

        held = self._apply_hold(raw_level, dt)
        alarm = self.debouncer.step(held)
        escalate = alarm > self._last_alarm and alarm >= 2 and self._cooldown_left <= 0
        if escalate:
            self._cooldown_left = self.cooldown_s
        self._last_alarm = alarm

        pairs.sort(
            key=lambda p: (
                self._edge_clearance(p.class_a, p.class_b, p.distance_m),
                p.ttc_s is None,
                p.ttc_s if p.ttc_s is not None else 99.0,
                p.distance_m,
            )
        )
        return {
            "pairs": [
                {
                    "track_a": p.track_a,
                    "track_b": p.track_b,
                    "class_a": p.class_a,
                    "class_b": p.class_b,
                    "distance_m": round(p.distance_m, 2),
                    "clearance_m": round(self._edge_clearance(p.class_a, p.class_b, p.distance_m), 2),
                    "ttc_s": None if p.ttc_s is None else round(float(p.ttc_s), 2),
                    "closing": bool(p.closing),
                }
                for p in pairs[:12]
            ],
            "min_ttc_s": None if min_ttc is None else round(min_ttc, 2),
            "min_distance_m": None if min_dist is None else round(min_dist, 2),
            "min_clearance_m": None if min_clearance is None else round(min_clearance, 2),
            "raw_level": raw_level,
            "alarm": LEVEL_NAME[alarm],
            "alarm_level": alarm,
            "zone_hits": zone_hits,
            "trip_events": trip_events,
            "trip_counts": dict(self.trip_counts),
            "occupancy": dict(self.occupancy),
            "escalate": escalate,
            "method": "proximity + constant-velocity discs + zones/tripwires",
        }
