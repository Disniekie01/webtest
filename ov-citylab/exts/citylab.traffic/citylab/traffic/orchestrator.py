"""Rule + learned orchestrator — comfort + busy + proximity → TraCI robot speed.

Writes JSONL action logs (default /tmp — Kit mounts citylab read-only).
Mode: CITYLAB_ORCH_MODE=rules|model|auto (auto uses model when policy file exists).
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any

import carb

from .policy_model import PolicyModel, rule_action

ORCH_ENABLED = os.environ.get("CITYLAB_ORCH", "1") == "1"
ORCH_MODE = os.environ.get("CITYLAB_ORCH_MODE", "auto").strip().lower()
W_COMFORT = float(os.environ.get("CITYLAB_ORCH_W_COMFORT", "1.0"))
W_BUSY = float(os.environ.get("CITYLAB_ORCH_W_BUSY", "0.65"))
W_PROX = float(os.environ.get("CITYLAB_ORCH_W_PROX", "1.25"))
PROX_M = float(os.environ.get("CITYLAB_ORCH_PROX_M", "2.5"))
BUSY_RADIUS_M = float(os.environ.get("CITYLAB_ORCH_BUSY_R_M", "8.0"))
BUSY_FULL_N = float(os.environ.get("CITYLAB_ORCH_BUSY_N", "5.0"))
SLOW_COST = float(os.environ.get("CITYLAB_ORCH_SLOW_COST", "0.35"))
HOLD_COST = float(os.environ.get("CITYLAB_ORCH_HOLD_COST", "0.65"))
ROBOT_SLOW = float(os.environ.get("CITYLAB_ORCH_SLOW", "0.35"))
LOG_DIR = Path(os.environ.get("CITYLAB_ORCH_LOG_DIR", "/tmp/citylab_orch_logs"))
POLICY_PATH = Path(
    os.environ.get(
        "CITYLAB_ORCH_POLICY",
        "/citylab/assets/orchestrator/policy_v0.json",
    )
)


def _is_robot(ptype: str) -> bool:
    return (ptype or "").split("@")[0] == "delivery_robot"


def _comfort_at(zones: dict[str, Any], x: float, z: float) -> tuple[float, int]:
    """Return (comfort 0..1, level). Default comfort=1 when no cells."""
    cells = zones.get("cells") or []
    if not cells:
        return 1.0, 0
    span = float(zones.get("span_m") or 160.0)
    cell_m = float(zones.get("cell_m") or 4.0)
    half = span * 0.5
    ix = int(math.floor((x + half) / cell_m))
    iz = int(math.floor((z + half) / cell_m))
    best = None
    for c in cells:
        if int(c.get("ix", -1)) == ix and int(c.get("iz", -1)) == iz:
            best = c
            break
    if best is None:
        for c in cells:
            if abs(int(c.get("ix", 0)) - ix) <= 1 and abs(int(c.get("iz", 0)) - iz) <= 1:
                best = c
                break
    if best is None:
        return 1.0, 0
    return float(best.get("comfort", 1.0)), int(best.get("level", 0))


def _busy01(humans: list[tuple[float, float]], x: float, z: float) -> float:
    if not humans or BUSY_FULL_N <= 0:
        return 0.0
    n = 0
    r2 = BUSY_RADIUS_M * BUSY_RADIUS_M
    for hx, hz in humans:
        dx = hx - x
        dz = hz - z
        if dx * dx + dz * dz <= r2:
            n += 1
    return min(1.0, n / BUSY_FULL_N)


def _prox_alarm(humans: list[tuple[float, float]], x: float, z: float) -> float:
    r2 = PROX_M * PROX_M
    for hx, hz in humans:
        dx = hx - x
        dz = hz - z
        if dx * dx + dz * dz <= r2:
            return 1.0
    return 0.0


def _speed_for_action(action: str) -> float:
    if action == "hold":
        return 0.0
    if action == "slow":
        return ROBOT_SLOW
    return -1.0  # TraCI: negative restores type max speed


class Orchestrator:
    def __init__(self, policy_path: Path | None = None) -> None:
        self.enabled = ORCH_ENABLED
        self._prev: dict[str, str] = {}
        self._last_actions: list[dict[str, Any]] = []
        self._log_path: Path | None = None
        self._tick = 0
        self._policy: PolicyModel | None = None
        self._scorer = "rules"
        path = policy_path or POLICY_PATH
        want_model = ORCH_MODE in ("model", "auto")
        if want_model:
            # Also try repo-relative path when not in Docker.
            candidates = [
                path,
                Path(__file__).resolve().parents[4] / "assets" / "orchestrator" / "policy_v0.json",
                Path(__file__).resolve().parents[3] / "assets" / "orchestrator" / "policy_v0.json",
            ]
            for cand in candidates:
                model = PolicyModel.load(cand)
                if model is not None:
                    self._policy = model
                    self._scorer = "model"
                    carb.log_warn(
                        f"[citylab.orch] policy model {model.version}/{model.kind} ← {cand}"
                    )
                    break
            if self._policy is None and ORCH_MODE == "model":
                carb.log_warn("[citylab.orch] CITYLAB_ORCH_MODE=model but no policy file — rules")
        if self.enabled:
            try:
                LOG_DIR.mkdir(parents=True, exist_ok=True)
                self._log_path = LOG_DIR / f"orch_{time.strftime('%Y%m%d')}.jsonl"
                carb.log_warn(
                    f"[citylab.orch] enabled scorer={self._scorer} log={self._log_path} "
                    f"w_c={W_COMFORT} w_b={W_BUSY} w_p={W_PROX}"
                )
            except Exception as exc:
                carb.log_warn(f"[citylab.orch] log dir: {exc}")

    def snapshot(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "tick": self._tick,
            "scorer": self._scorer,
            "mode": ORCH_MODE,
            "actions": list(self._last_actions),
            "log": str(self._log_path) if self._log_path else None,
        }

    def _decide(self, comfort: float, busy: float, prox: float, level: int) -> tuple[str, float]:
        if self._policy is not None and self._scorer == "model":
            action = self._policy.predict(comfort, busy, prox, level)
        else:
            action = rule_action(
                comfort,
                busy,
                prox,
                level,
                w_c=W_COMFORT,
                w_b=W_BUSY,
                w_p=W_PROX,
                slow_cost=SLOW_COST,
                hold_cost=HOLD_COST,
            )
        # Absolute safety clamps (even if model misfires).
        if prox >= 1.0 or level >= 3:
            action = "hold"
        cost = W_COMFORT * (1.0 - comfort) + W_BUSY * busy + W_PROX * prox
        return action, cost

    def step(
        self,
        traci_mod,
        pedestrians: list[tuple],
        comfort_zones: dict[str, Any] | None,
        sim_t: float | None = None,
    ) -> list[dict[str, Any]]:
        """Apply speed policy to delivery_robot persons. pedestrians: (id,x,y,z,yaw,type)."""
        self._tick += 1
        if not self.enabled or traci_mod is None:
            self._last_actions = []
            return []

        zones = comfort_zones or {}
        humans = [
            (float(ux), float(uz))
            for pid, ux, _uy, uz, _yaw, ptype in pedestrians
            if not _is_robot(str(ptype))
        ]
        robots = [
            (str(pid), float(ux), float(uz), str(ptype))
            for pid, ux, _uy, uz, _yaw, ptype in pedestrians
            if _is_robot(str(ptype))
        ]

        actions: list[dict[str, Any]] = []
        t = float(sim_t if sim_t is not None else time.time())
        for pid, x, z, ptype in robots:
            comfort, level = _comfort_at(zones, x, z)
            busy = _busy01(humans, x, z)
            prox = _prox_alarm(humans, x, z)
            action, cost = self._decide(comfort, busy, prox, level)
            speed = _speed_for_action(action)
            # Clamp: never faster than cruise via positive setSpeed.
            if speed > 1.1:
                speed = 1.1
            try:
                traci_mod.person.setSpeed(pid, speed)
            except Exception as exc:
                if self._tick % 120 == 1:
                    carb.log_warn(f"[citylab.orch] setSpeed {pid}: {exc}")
                continue

            row = {
                "t": round(t, 3),
                "robot_id": pid,
                "x": round(x, 2),
                "z": round(z, 2),
                "comfort": round(comfort, 3),
                "level": level,
                "busy": round(busy, 3),
                "prox": prox,
                "cost": round(cost, 3),
                "action": action,
                "speed": speed,
                "scorer": self._scorer,
            }
            actions.append(row)
            if self._prev.get(pid) != action:
                self._append_log(row)
                if self._tick <= 5 or action != "proceed":
                    carb.log_warn(
                        f"[citylab.orch] {pid} → {action} ({self._scorer}) cost={cost:.2f} "
                        f"comfort={comfort:.2f} busy={busy:.2f} prox={prox:.0f}"
                    )
            self._prev[pid] = action

        live = {a["robot_id"] for a in actions}
        for stale in list(self._prev.keys()):
            if stale not in live:
                self._prev.pop(stale, None)

        self._last_actions = actions
        return actions

    def _append_log(self, row: dict[str, Any]) -> None:
        if not self._log_path:
            return
        try:
            with self._log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, separators=(",", ":")) + "\n")
        except Exception:
            pass
