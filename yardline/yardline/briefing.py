from __future__ import annotations

from datetime import date
from typing import Any, Optional


def build_briefing(packet: Optional[dict[str, Any]], source: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Scene note from live telemetry. Not a compliance document."""
    if packet is None:
        return {
            "ok": False,
            "title": "No telemetry yet",
            "body": "Play a source first. This note is assembled from the last inferred frame, not from a language model.",
        }

    tracks = [t for t in packet.get("tracks", []) if t.get("confirmed")]
    workers = [t for t in tracks if t["class_name"] == "worker"]
    machines = [t for t in tracks if t["class_name"] == "machine"]
    vehicles = [t for t in tracks if t["class_name"] == "vehicle"]
    risk = packet.get("risk") or {}
    src_name = Path_name(source)
    live = bool(source and source.get("live"))

    lines = [
        f"irl CVtest scene note — {date.today().isoformat()}",
        f"Source: {src_name}",
        f"Frame {packet.get('frame_index', 0)}"
        + (f" / {source['frames']}" if source and source.get("frames") else " · live"),
        "",
        f"People tracked: {len(workers)}",
        f"Vehicles tracked: {len(vehicles)}",
        f"Plant tracked: {len(machines)}",
        f"Alarm: {risk.get('alarm', 'unknown')} (raw level {risk.get('raw_level', 0)})",
    ]
    if not packet.get("calibrated"):
        lines += ["", "Ground plane is not set. Distances and TTC were not computed."]
    else:
        dist = risk.get("min_distance_m")
        ttc = risk.get("min_ttc_s")
        lines += [
            f"Closest person–vehicle separation: {dist if dist is not None else 'n/a'} m",
            f"Minimum constant-velocity TTC: {ttc if ttc is not None else 'no predicted overlap'} s",
            f"Method: {risk.get('method')}",
        ]
        hits = risk.get("zone_hits") or []
        if hits:
            lines.append("Zone hits: " + ", ".join(f"{h['name']}←track {h['track_id']}" for h in hits))
        else:
            lines.append("No people inside drawn polygons this frame.")

    pairs = [p for p in (risk.get("pairs") or []) if p.get("ttc_s") is not None]
    pairs.sort(key=lambda p: p["ttc_s"])
    if pairs:
        lines.append("")
        lines.append("Closest predicted overlaps:")
        for p in pairs[:5]:
            other = p.get("class_b", "vehicle")
            lines.append(
                f"  person {p['track_a']} / {other} {p['track_b']}: "
                f"{p['distance_m']} m now, TTC {p['ttc_s']} s"
                + (" closing" if p.get("closing") else "")
            )

    if live:
        lines += [
            "",
            "City reminders (static checklist, not model output):",
            "  Heading is the same world-velocity lock for people and cars.",
            "  Distant COCO boxes drop out; this is not a trained traffic detector.",
            "  TTC is constant-velocity discs on the homography, not intent.",
        ]
    else:
        lines += [
            "",
            "Field reminders (static checklist, not model output):",
            "  Keep a dedicated spotter on swinging plant.",
            "  Do not walk behind counterweights.",
            "  Confirm exclusion polygons match today's permit.",
        ]
    return {"ok": True, "title": f"Scene note · {src_name}", "body": "\n".join(lines)}


def Path_name(source: Optional[dict[str, Any]]) -> str:
    if not source:
        return "none"
    from pathlib import Path

    return Path(source.get("path", "unknown")).name
