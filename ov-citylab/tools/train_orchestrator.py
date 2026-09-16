#!/usr/bin/env python3
"""Train a Phase-5 orchestrator policy from JSONL logs (or synthetic rules).

Usage:
  python tools/train_orchestrator.py \\
    --logs /tmp/citylab_orch_logs/orch_20260916.jsonl \\
    --out assets/orchestrator/policy_v0.json

If --logs is missing/empty, synthesizes samples from the rule thresholds.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY_PY = ROOT / "exts" / "citylab.traffic" / "citylab" / "traffic" / "policy_model.py"


def _load_policy_mod():
    spec = importlib.util.spec_from_file_location("policy_model", POLICY_PY)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


pm = _load_policy_mod()
ACTIONS = pm.ACTIONS
features = pm.features
rule_action = pm.rule_action


def load_rows(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def synthesize(n: int = 2400) -> list[dict]:
    rng = random.Random(7)
    rows = []
    for _ in range(n):
        comfort = rng.random()
        busy = rng.random()
        prox = 1.0 if rng.random() < 0.12 else 0.0
        level = rng.choice([0, 0, 1, 1, 2, 3])
        action = rule_action(
            comfort,
            busy,
            prox,
            level,
            w_c=1.0,
            w_b=0.65,
            w_p=1.25,
            slow_cost=0.35,
            hold_cost=0.65,
        )
        rows.append(
            {
                "comfort": comfort,
                "busy": busy,
                "prox": prox,
                "level": level,
                "action": action,
            }
        )
    return rows


def fit_centroids(rows: list[dict]) -> dict[str, list[float]]:
    buckets: dict[str, list[list[float]]] = defaultdict(list)
    for r in rows:
        act = str(r.get("action") or "")
        if act not in ACTIONS:
            continue
        buckets[act].append(
            features(
                float(r.get("comfort", 1.0)),
                float(r.get("busy", 0.0)),
                float(r.get("prox", 0.0)),
                int(r.get("level", 0)),
            )
        )
    out: dict[str, list[float]] = {}
    dim = 4
    for act in ACTIONS:
        pts = buckets.get(act) or []
        if not pts:
            out[act] = [0.0] * dim
            continue
        out[act] = [sum(p[i] for p in pts) / len(pts) for i in range(dim)]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--logs", nargs="*", default=[], help="JSONL orch log paths")
    ap.add_argument(
        "--out",
        default=str(ROOT / "assets" / "orchestrator" / "policy_v0.json"),
    )
    ap.add_argument("--synthetic", type=int, default=2400)
    args = ap.parse_args()

    paths = [Path(p) for p in args.logs]
    rows = load_rows(paths)
    source = "logs"
    if len(rows) < 40:
        rows = synthesize(args.synthetic)
        source = "synthetic_rules"

    centroids = fit_centroids(rows)
    counts = {a: 0 for a in ACTIONS}
    for r in rows:
        a = str(r.get("action") or "")
        if a in counts:
            counts[a] += 1

    payload = {
        "version": "v0",
        "kind": "centroids",
        "actions": list(ACTIONS),
        "centroids": centroids,
        "source": source,
        "n_samples": len(rows),
        "counts": counts,
        "feature_names": ["discomfort", "busy", "prox", "level_n"],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} source={source} n={len(rows)} counts={counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
