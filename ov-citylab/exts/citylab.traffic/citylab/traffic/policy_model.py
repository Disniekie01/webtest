"""Learned orchestrator scorer — centroid / linear imitation with safety clamps."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

ACTIONS = ("proceed", "slow", "hold")


def features(comfort: float, busy: float, prox: float, level: int) -> list[float]:
    """State vector used for imitation."""
    return [
        1.0 - float(comfort),
        float(busy),
        float(prox),
        float(level) / 3.0,
    ]


def _softmax(logits: list[float]) -> list[float]:
    m = max(logits)
    ex = [math.exp(x - m) for x in logits]
    s = sum(ex) or 1.0
    return [e / s for e in ex]


class PolicyModel:
    """Nearest-centroid or linear softmax policy loaded from JSON."""

    def __init__(self, data: dict[str, Any]):
        self.version = str(data.get("version") or "v0")
        self.kind = str(data.get("kind") or "centroids")
        self.actions = list(data.get("actions") or ACTIONS)
        self.centroids = {
            str(k): [float(x) for x in v]
            for k, v in (data.get("centroids") or {}).items()
        }
        self.weights = data.get("weights")  # action -> list[float] incl bias last
        self.source = str(data.get("source") or "")

    @classmethod
    def load(cls, path: Path) -> "PolicyModel | None":
        if not path.is_file():
            return None
        try:
            return cls(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def predict(self, comfort: float, busy: float, prox: float, level: int) -> str:
        # Hard safety clamps — never override proximity / avoid cells.
        if float(prox) >= 1.0 or int(level) >= 3:
            return "hold"
        feat = features(comfort, busy, prox, level)
        if self.kind == "linear" and self.weights:
            logits = []
            for act in self.actions:
                w = self.weights.get(act) or []
                if len(w) < len(feat) + 1:
                    logits.append(-1e9)
                    continue
                score = float(w[-1])
                for i, x in enumerate(feat):
                    score += float(w[i]) * x
                logits.append(score)
            probs = _softmax(logits)
            return self.actions[max(range(len(probs)), key=lambda i: probs[i])]
        # Centroids (default)
        best_a = "proceed"
        best_d = 1e18
        for act in self.actions:
            c = self.centroids.get(act)
            if not c or len(c) != len(feat):
                continue
            d = sum((a - b) * (a - b) for a, b in zip(feat, c))
            if d < best_d:
                best_d = d
                best_a = act
        if best_a == "proceed" and feat[0] + feat[1] > 0.7:
            return "slow"
        return best_a


def rule_action(
    comfort: float,
    busy: float,
    prox: float,
    level: int,
    *,
    w_c: float,
    w_b: float,
    w_p: float,
    slow_cost: float,
    hold_cost: float,
) -> str:
    if float(prox) >= 1.0 or int(level) >= 3:
        return "hold"
    cost = w_c * (1.0 - comfort) + w_b * busy + w_p * prox
    if cost >= hold_cost:
        return "hold"
    if int(level) >= 2 or cost >= slow_cost:
        return "slow"
    return "proceed"
