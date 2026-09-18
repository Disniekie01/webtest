from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from yardline.incidents import list_incidents
from yardline.sites import get_active_site
from yardline.store import list_labels
from yardline.taxonomy import count_kpi, load_taxonomy

ROOT = Path(__file__).resolve().parent.parent


def build_shift_report(*, limit_incidents: int = 200, limit_labels: int = 200) -> dict[str, Any]:
    incidents = list_incidents(limit_incidents)
    labels = list_labels(limit_labels)
    trip_total = 0
    by_alarm: dict[str, int] = {}
    by_event_code: dict[str, int] = {}
    for inc in incidents:
        alarm = str(inc.get("alarm") or "unknown")
        by_alarm[alarm] = by_alarm.get(alarm, 0) + 1
        code = str(inc.get("event_code") or "UNCODED")
        by_event_code[code] = by_event_code.get(code, 0) + 1
        for te in inc.get("trip_events") or []:
            trip_total += 1
            _ = te
    label_counts: dict[str, int] = {}
    for lab in labels:
        k = str(lab.get("kind") or "other")
        label_counts[k] = label_counts.get(k, 0) + 1

    site = get_active_site()
    kpi = None
    if site and site.get("kpi"):
        kpi = count_kpi(incidents, str(site["kpi"]))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "site": None
        if site is None
        else {
            "id": site.get("id"),
            "name": site.get("name"),
            "kpi": site.get("kpi"),
        },
        "summary": {
            "incidents": len(incidents),
            "by_alarm": by_alarm,
            "by_event_code": by_event_code,
            "labels": label_counts,
            "tripwire_events_logged": trip_total,
            "kpi": kpi,
        },
        "taxonomy": {
            "events": (load_taxonomy().get("events") or []),
            "kpis": (load_taxonomy().get("kpis") or []),
        },
        "incidents": incidents,
        "labels": labels,
    }


def report_to_csv(report: dict[str, Any]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section", "key", "value"])
    writer.writerow(["meta", "generated_at", report.get("generated_at")])
    site = report.get("site") or {}
    if site:
        writer.writerow(["site", "id", site.get("id")])
        writer.writerow(["site", "name", site.get("name")])
        writer.writerow(["site", "kpi", site.get("kpi")])
    summary = report.get("summary") or {}
    writer.writerow(["summary", "incidents", summary.get("incidents", 0)])
    kpi = summary.get("kpi") or {}
    if kpi:
        writer.writerow(["kpi", kpi.get("id"), kpi.get("count")])
    for k, v in (summary.get("by_alarm") or {}).items():
        writer.writerow(["alarm", k, v])
    for k, v in (summary.get("by_event_code") or {}).items():
        writer.writerow(["event_code", k, v])
    for k, v in (summary.get("labels") or {}).items():
        writer.writerow(["label", k, v])
    writer.writerow([])
    writer.writerow(
        [
            "incident_id",
            "event_code",
            "alarm",
            "site_id",
            "camera_id",
            "frame",
            "source",
            "ttc",
            "clearance",
            "still",
            "clip",
            "created_at",
        ]
    )
    for inc in report.get("incidents") or []:
        writer.writerow(
            [
                inc.get("id"),
                inc.get("event_code"),
                inc.get("alarm"),
                inc.get("site_id"),
                inc.get("camera_id"),
                inc.get("frame_index"),
                inc.get("source"),
                inc.get("min_ttc_s"),
                inc.get("min_clearance_m"),
                inc.get("still"),
                inc.get("clip"),
                inc.get("created_at"),
            ]
        )
    return buf.getvalue()


def save_report_json(report: dict[str, Any]) -> Path:
    out_dir = ROOT / "data" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    path = out_dir / f"shift_{stamp}.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path
