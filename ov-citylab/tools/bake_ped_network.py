#!/usr/bin/env python3
"""Bake CityGen sidewalks + crossings (+ building parcels) into the SUMO net.

Keeps vehicle lanes where they are (no --sidewalks.guess). Adds a parallel
pedestrian graph on measured CityGenside_walks centers, with crosswalks at
junctions and rectangular building parcels in the block interiors.

Requires: assets/sumo/sidewalks.json (from extract_sidewalks_usd.py)
          assets/sumo/city_var.nod.xml / city_var.edg.xml (from build_sumo_varwidth.py)

  python tools/bake_ped_network.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "sumo"
SUMO_HOME = (
    ROOT
    / ".venv"
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}"
    / "site-packages"
    / "sumo"
)
BIN = SUMO_HOME / "bin"

JUNCTIONS = 5
BLOCK = 40.0
PED_SPEED = 1.39  # ~5 km/h
PED_WIDTH = 1.3
CROSS_WIDTH = 1.3


def jid(i: int, j: int) -> str:
    return f"{chr(ord('A') + i)}{j}"


def load_ribbons() -> dict[tuple[str, float, str], dict]:
    data = json.loads((OUT / "sidewalks.json").read_text(encoding="utf-8"))
    out: dict[tuple[str, float, str], dict] = {}
    for r in data["ribbons"]:
        key = (r["dir"], round(float(r["line_sumo"]), 1), r["side"])
        out[key] = r
    return out


def ns_ribbon(ribbons, i: int, side: str):
    return ribbons.get(("NS", round(i * BLOCK, 1), side))


def ew_ribbon(ribbons, j: int, side: str):
    return ribbons.get(("EW", round(j * BLOCK, 1), side))


def pid(i: int, j: int, ns_side: str, ew_side: str) -> str:
    return f"P_{i}_{j}_{ns_side}_{ew_side}"


def rewrite_vehicle_edges_disallow_ped(src: Path, dst: Path) -> None:
    text = src.read_text(encoding="utf-8")
    # Ensure passenger edges ban pedestrians so walks use the sidewalk graph.
    def _patch(m: re.Match[str]) -> str:
        tag = m.group(0)
        if "allow=" in tag or "disallow=" in tag:
            return tag
        return tag[:-2] + ' disallow="pedestrian"/>'

    text2 = re.sub(r"<edge\b[^>]*/>", _patch, text)
    dst.write_text(text2, encoding="utf-8")


def build_ped_plain(ribbons) -> tuple[Path, Path, list[dict], list[dict], dict]:
    """Build ped node/edge plain files. Returns nodes dict for post-repair."""
    nodes: dict[str, tuple[float, float]] = {}
    edges: list[str] = []
    crossings_meta: list[dict] = []
    sidewalk_meta: list[dict] = []

    def add_node(i: int, j: int, ns_s: str, ew_s: str) -> str | None:
        nr = ns_ribbon(ribbons, i, ns_s)
        er = ew_ribbon(ribbons, j, ew_s)
        if not nr or not er:
            return None
        nid = pid(i, j, ns_s, ew_s)
        nodes[nid] = (float(nr["center_sumo"]), float(er["center_sumo"]))
        return nid

    # Create all feasible corner nodes
    for i in range(JUNCTIONS):
        for j in range(JUNCTIONS):
            for ns_s in ("L", "R"):
                for ew_s in ("B", "T"):
                    add_node(i, j, ns_s, ew_s)

    def add_bidir(eid: str, a: str, b: str, width: float, kind: str) -> None:
        if a not in nodes or b not in nodes:
            return
        ax, ay = nodes[a]
        bx, by = nodes[b]
        shape = f"{ax:.3f},{ay:.3f} {bx:.3f},{by:.3f}"
        for fr, to, suffix, sh in (
            (a, b, "", shape),
            (b, a, "_r", f"{bx:.3f},{by:.3f} {ax:.3f},{ay:.3f}"),
        ):
            edges.append(
                f'  <edge id="{eid}{suffix}" from="{fr}" to="{to}" numLanes="1" '
                f'speed="{PED_SPEED}" width="{width}" allow="pedestrian" '
                f'spreadType="center" shape="{sh}"/>'
            )
        sidewalk_meta.append({"id": eid, "kind": kind, "from": a, "to": b})

    # NS sidewalk segments (along Y) between row j and j+1
    for i in range(JUNCTIONS):
        for j in range(JUNCTIONS - 1):
            for side in ("L", "R"):
                # leave south junction on its Top side, enter north on Bottom
                a = add_node(i, j, side, "T")
                b = add_node(i, j + 1, side, "B")
                if a and b:
                    add_bidir(f"SW_NS_{i}_{j}_{j+1}_{side}", a, b, PED_WIDTH, "sidewalk_ns")

    # EW sidewalk segments (along X) between col i and i+1
    for j in range(JUNCTIONS):
        for i in range(JUNCTIONS - 1):
            for side in ("B", "T"):
                a = add_node(i, j, "R", side)
                b = add_node(i + 1, j, "L", side)
                if a and b:
                    add_bidir(f"SW_EW_{j}_{i}_{i+1}_{side}", a, b, PED_WIDTH, "sidewalk_ew")

    # Crossings at each junction
    for i in range(JUNCTIONS):
        for j in range(JUNCTIONS):
            # Across the NS carriageway (west sidewalk ↔ east sidewalk)
            for ew_s in ("B", "T"):
                a = add_node(i, j, "L", ew_s)
                b = add_node(i, j, "R", ew_s)
                if a and b:
                    eid = f"CR_NS_{i}_{j}_{ew_s}"
                    add_bidir(eid, a, b, CROSS_WIDTH, "crossing_ns")
                    crossings_meta.append(
                        {"id": eid, "junction": jid(i, j), "across": "NS", "side": ew_s}
                    )
            # Across the EW carriageway (south sidewalk ↔ north sidewalk)
            for ns_s in ("L", "R"):
                a = add_node(i, j, ns_s, "B")
                b = add_node(i, j, ns_s, "T")
                if a and b:
                    eid = f"CR_EW_{i}_{j}_{ns_s}"
                    add_bidir(eid, a, b, CROSS_WIDTH, "crossing_ew")
                    crossings_meta.append(
                        {"id": eid, "junction": jid(i, j), "across": "EW", "side": ns_s}
                    )

    nod_path = OUT / "city_ped.nod.xml"
    edg_path = OUT / "city_ped.edg.xml"
    # radius=0 keeps netconvert from eating crosswalks into junction bubbles.
    nod_lines = [
        f'  <node id="{nid}" x="{xy[0]:.3f}" y="{xy[1]:.3f}" type="traffic_light" radius="0.1"/>'
        for nid, xy in sorted(nodes.items())
    ]
    nod_path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<nodes>\n'
        + "\n".join(nod_lines)
        + "\n</nodes>\n",
        encoding="utf-8",
    )
    edg_path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<edges>\n'
        + "\n".join(edges)
        + "\n</edges>\n",
        encoding="utf-8",
    )
    print(f"ped nodes={len(nodes)} edges={len(edges)//2} (bidir pairs)", flush=True)
    return nod_path, edg_path, crossings_meta, sidewalk_meta, nodes



def build_building_polys(ribbons) -> Path:
    """Block-interior parcels from sidewalk outer edges (proxy for buildings)."""
    polys: list[str] = []
    meta: list[dict] = []
    for i in range(JUNCTIONS - 1):
        for j in range(JUNCTIONS - 1):
            # Outer edge of sidewalks facing into this block
            left = ns_ribbon(ribbons, i, "R")  # east sidewalk of west street
            right = ns_ribbon(ribbons, i + 1, "L")
            bot = ew_ribbon(ribbons, j, "T")
            top = ew_ribbon(ribbons, j + 1, "B")
            if not all((left, right, bot, top)):
                continue
            x0 = float(left["center_sumo"]) + float(left["width_m"]) * 0.5
            x1 = float(right["center_sumo"]) - float(right["width_m"]) * 0.5
            y0 = float(bot["center_sumo"]) + float(bot["width_m"]) * 0.5
            y1 = float(top["center_sumo"]) - float(top["width_m"]) * 0.5
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            pid_ = f"BLDG_{i}_{j}"
            shape = f"{x0:.2f},{y0:.2f} {x1:.2f},{y0:.2f} {x1:.2f},{y1:.2f} {x0:.2f},{y1:.2f}"
            polys.append(
                f'  <poly id="{pid_}" type="building" color="0.7,0.7,0.7" '
                f'fill="1" layer="-1" shape="{shape}"/>'
            )
            meta.append({"id": pid_, "x0": x0, "x1": x1, "y0": y0, "y1": y1})

    path = OUT / "buildings.poly.xml"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<additional xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/additional_file.xsd">\n'
        + "\n".join(polys)
        + "\n</additional>\n",
        encoding="utf-8",
    )
    (OUT / "buildings.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"building parcels={len(meta)} → {path.name}", flush=True)
    return path


def collapse_ped_junction_gaps(net_path: Path, nodes: dict[str, tuple[float, float]]) -> int:
    """Make SW_/CR_ lanes meet at their node so walkers never skip a corner.

    netconvert reserves a 4x4 m plaza at each ped corner (our sidewalks are 4 m
    wide), but the striping model does not walk pedestrians across plain
    internal lanes -- it hands them straight to the next lane, which reads as a
    6 m teleport. Extending the lanes to the node and shrinking the internal
    links to stubs leaves nothing to skip.
    """
    import math
    import xml.etree.ElementTree as ET

    tree = ET.parse(net_path)
    root = tree.getroot()

    def parse_shape(s: str) -> list[tuple[float, float]]:
        out = []
        for chunk in (s or "").split():
            xy = chunk.split(",")
            if len(xy) >= 2:
                out.append((float(xy[0]), float(xy[1])))
        return out

    fixed = 0
    for edge in root.findall("edge"):
        eid = edge.get("id") or ""
        if not (eid.startswith("SW_") or eid.startswith("CR_")):
            continue
        if edge.get("function"):
            continue
        fr, to = edge.get("from"), edge.get("to")
        if fr not in nodes or to not in nodes:
            continue
        ax, ay = nodes[fr]
        bx, by = nodes[to]
        length = math.dist((ax, ay), (bx, by))
        if length < 0.05:
            continue
        shape = f"{ax:.3f},{ay:.3f} {bx:.3f},{by:.3f}"
        edge.set("shape", shape)
        edge.set("spreadType", "center")
        for lane in edge.findall("lane"):
            lane.set("shape", shape)
            lane.set("length", f"{length:.2f}")
        fixed += 1

    # Re-collect lane geometry, then shrink ped internal lanes to stubs that
    # start exactly where the incoming lane ends.
    lane_shape: dict[str, list[tuple[float, float]]] = {}
    for edge in root.findall("edge"):
        for lane in edge.findall("lane"):
            lid = lane.get("id") or ""
            lane_shape[lid] = parse_shape(lane.get("shape") or "")

    via_target: dict[str, tuple[str, str]] = {}
    for conn in root.findall("connection"):
        via = conn.get("via")
        if not via or not via.startswith(":P_"):
            continue
        f = f'{conn.get("from")}_{conn.get("fromLane")}'
        s = f'{conn.get("to")}_{conn.get("toLane")}'
        via_target[via] = (f, s)

    stubs = 0
    for edge in root.findall("edge"):
        if edge.get("function") != "internal":
            continue
        for lane in edge.findall("lane"):
            lid = lane.get("id") or ""
            pair = via_target.get(lid)
            if not pair:
                continue
            f_pts = lane_shape.get(pair[0]) or []
            t_pts = lane_shape.get(pair[1]) or []
            if not f_pts or not t_pts:
                continue
            sx, sy = f_pts[-1]
            ex, ey = t_pts[0]
            d = math.dist((sx, sy), (ex, ey))
            if d < 0.1:
                # Degenerate link: aim the stub along the outgoing lane.
                if len(t_pts) > 1:
                    dx, dy = t_pts[1][0] - ex, t_pts[1][1] - ey
                    norm = math.hypot(dx, dy) or 1.0
                    ex, ey = sx + 0.1 * dx / norm, sy + 0.1 * dy / norm
                else:
                    ex, ey = sx + 0.1, sy
                d = 0.1
            lane.set("shape", f"{sx:.3f},{sy:.3f} {ex:.3f},{ey:.3f}")
            lane.set("length", f"{max(d, 0.1):.2f}")
            stubs += 1

    tree.write(net_path, encoding="UTF-8", xml_declaration=True)
    print(
        f"collapsed ped corner gaps: {fixed} lanes squared to nodes, "
        f"{stubs} internal links stubbed",
        flush=True,
    )
    return fixed


def write_ped_connections(nodes: dict[str, tuple[float, float]], ped_edg: Path) -> Path:
    """Write ped-ped connections so walkers use controlled links at corners."""
    import re

    edges: list[tuple[str, str, str]] = []
    for m in re.finditer(
        r'<edge id="([^"]+)" from="([^"]+)" to="([^"]+)"',
        ped_edg.read_text(encoding="utf-8"),
    ):
        edges.append((m.group(1), m.group(2), m.group(3)))

    outgoing: dict[str, list[str]] = {}
    incoming: dict[str, list[str]] = {}
    for eid, fr, to in edges:
        outgoing.setdefault(fr, []).append(eid)
        incoming.setdefault(to, []).append(eid)

    def _is_cross(eid: str) -> bool:
        base = eid[:-2] if eid.endswith("_r") else eid
        return base.startswith("CR_")

    con_lines: list[str] = []
    for nid in sorted(nodes):
        # Controlled SW→CR first so netconvert assigns low linkIndices to crossings
        pairs = [
            (fr, to)
            for fr in incoming.get(nid, [])
            for to in outgoing.get(nid, [])
            if fr != to
        ]
        pairs.sort(key=lambda ft: (0 if (_is_cross(ft[1]) and not _is_cross(ft[0])) else 1, ft[0], ft[1]))
        link_i = 0
        for fr, to in pairs:
            controlled = _is_cross(to) and not _is_cross(fr)
            if controlled:
                con_lines.append(
                    f'  <connection from="{fr}" to="{to}" fromLane="0" toLane="0" '
                    f'tl="{nid}" linkIndex="{link_i}"/>'
                )
                link_i += 1
            else:
                con_lines.append(
                    f'  <connection from="{fr}" to="{to}" fromLane="0" toLane="0"/>'
                )

    con_path = OUT / "city_ped.con.xml"
    con_path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<connections>\n'
        + "\n".join(con_lines)
        + "\n</connections>\n",
        encoding="utf-8",
    )
    print(f"ped connections={len(con_lines)} → {con_path.name}", flush=True)
    return con_path


def _veh_edge_axis(eid: str) -> str:
    """B0B1 → NS (same column letter); A1B1 → EW (same row digit)."""
    if len(eid) >= 4 and eid[0].isalpha() and eid[2].isalpha() and eid[1].isdigit() and eid[3].isdigit():
        if eid[0] == eid[2]:
            return "NS"
        if eid[1] == eid[3]:
            return "EW"
    return "?"


def _is_cr(eid: str) -> bool:
    base = eid[:-2] if eid.endswith("_r") else eid
    return base.startswith("CR_")


def _cr_axis(eid: str) -> str:
    base = eid[:-2] if eid.endswith("_r") else eid
    if base.startswith("CR_NS_"):
        return "NS"
    if base.startswith("CR_EW_"):
        return "EW"
    return "?"


def _ped_link_kind(fr: str, to: str) -> tuple[str, str | None]:
    """Return (kind, conflict_axis). kind: enter|exit|free."""
    if _is_cr(to) and not _is_cr(fr):
        return "enter", _cr_axis(to)
    if _is_cr(fr) and not _is_cr(to):
        return "exit", _cr_axis(fr)
    if _is_cr(fr) and _is_cr(to):
        return "enter", _cr_axis(to)
    return "free", None


def sync_ped_tls_to_vehicle(net_path: Path) -> int:
    """Align ped crosswalk lights with vehicle junction phases.

    Entering CR_NS (across NS traffic) is green only when EW cars run.
    Entering CR_EW is green only when NS cars run.
    Yellow → stop new entries; exits/sidewalk turns stay green so queues clear.
    """
    import xml.etree.ElementTree as ET

    tree = ET.parse(net_path)
    root = tree.getroot()

    veh_phases: dict[str, list[tuple[float, str]]] = {}
    veh_offset: dict[str, str] = {}
    for tl in root.findall("tlLogic"):
        tid = tl.get("id") or ""
        if tid.startswith("P_"):
            continue
        phases = [
            (float(p.get("duration") or 0), p.get("state") or "")
            for p in tl.findall("phase")
        ]
        if phases:
            veh_phases[tid] = phases
            veh_offset[tid] = tl.get("offset") or "0"

    veh_link_axis: dict[str, dict[int, str]] = {}
    for conn in root.findall("connection"):
        tid = conn.get("tl")
        if not tid or tid.startswith("P_"):
            continue
        idx = conn.get("linkIndex")
        if idx is None:
            continue
        veh_link_axis.setdefault(tid, {})[int(idx)] = _veh_edge_axis(conn.get("from") or "")

    def veh_phase_axis(tid: str, state: str) -> str:
        axes = veh_link_axis.get(tid, {})
        ns_g = any(
            i < len(state) and state[i] in "Gg" and axes.get(i) == "NS" for i in axes
        )
        ew_g = any(
            i < len(state) and state[i] in "Gg" and axes.get(i) == "EW" for i in axes
        )
        if ns_g and not ew_g:
            return "NS"
        if ew_g and not ns_g:
            return "EW"
        return "CLEAR"

    def ped_to_veh(pid_: str) -> str | None:
        parts = pid_.split("_")
        if len(parts) != 5 or not parts[1].isdigit() or not parts[2].isdigit():
            return None
        return f"{chr(ord('A') + int(parts[1]))}{parts[2]}"

    # Ped tl → linkIndex → (kind, axis)
    ped_links: dict[str, list[tuple[str, str | None]]] = {}
    for conn in root.findall("connection"):
        tid = conn.get("tl") or ""
        if not tid.startswith("P_"):
            continue
        idx = int(conn.get("linkIndex") or 0)
        kind, ax = _ped_link_kind(conn.get("from") or "", conn.get("to") or "")
        lst = ped_links.setdefault(tid, [])
        while len(lst) <= idx:
            lst.append(("free", None))
        lst[idx] = (kind, ax)

    n = 0
    for tl in root.findall("tlLogic"):
        tid = tl.get("id") or ""
        if not tid.startswith("P_"):
            continue
        links = ped_links.get(tid)
        if not links:
            continue
        slen = len(links)
        vjid = ped_to_veh(tid)
        vphases = veh_phases.get(vjid or "", [])

        for p in list(tl):
            tl.remove(p)

        if not vphases:
            ET.SubElement(tl, "phase", {"duration": "15", "state": "r" * slen})
            ET.SubElement(tl, "phase", {"duration": "12", "state": "G" * slen})
            ET.SubElement(tl, "phase", {"duration": "3", "state": "r" * slen})
            tl.set("programID", "natural")
            n += 1
            continue

        for dur, vstate in vphases:
            vax = veh_phase_axis(vjid, vstate)
            chars: list[str] = []
            for kind, ax in links:
                if kind == "free":
                    chars.append("g")
                    continue
                # exit: allow clearing during yellow; enter: only when opposing cars run
                if vax == "CLEAR":
                    chars.append("G" if kind == "exit" else "r")
                    continue
                walk = (ax == "NS" and vax == "EW") or (ax == "EW" and vax == "NS")
                if kind == "enter":
                    chars.append("g" if walk else "r")
                else:  # exit — never trap walkers mid-cross / leaving CR
                    chars.append("G")
            ET.SubElement(
                tl, "phase", {"duration": f"{dur:.0f}", "state": "".join(chars)}
            )

        tl.set("offset", veh_offset.get(vjid, "0"))
        tl.set("programID", "natural")
        n += 1

    tree.write(net_path, encoding="UTF-8", xml_declaration=True)
    print(
        f"synced {n} ped TLS to vehicle greens "
        f"(enter crosswalk with opposing traffic; exits/sidewalks stay open)",
        flush=True,
    )
    return n



# Walkers must clear the gutter and the building faces.
CURB_MARGIN_M = 0.45
BUILDING_MARGIN_M = 0.55


def write_ped_bands(net_path: Path, ribbons: dict[tuple[str, float, str], dict]) -> Path:
    """Per-segment walkable lateral band for every sidewalk edge.

    sidewalks.json holds one ribbon per corridor, but the carriageway changes
    width block to block, so a corridor-wide ribbon reports its inner edge from
    the narrowest block and overlaps the road everywhere else. Measure the real
    carriageway beside each segment instead.
    """
    sys.path.insert(0, str(SUMO_HOME / "tools"))
    import sumolib  # noqa: E402

    net = sumolib.net.readNet(str(net_path))

    def carriageway(eids: list[str], axis: int) -> tuple[float, float] | None:
        lo, hi = 1e9, -1e9
        for eid in eids:
            try:
                edge = net.getEdge(eid)
            except Exception:
                continue
            for lane in edge.getLanes():
                half = lane.getWidth() / 2.0
                for point in lane.getShape():
                    v = point[axis]
                    lo = min(lo, v - half)
                    hi = max(hi, v + half)
        return (lo, hi) if lo < hi else None

    bands: dict[str, dict] = {}
    for edge in net.getEdges():
        eid = edge.getID()
        if not eid.startswith("SW_") or eid.endswith("_r"):
            continue
        parts = eid.split("_")
        if len(parts) < 6:
            continue
        side = parts[-1]
        try:
            a, b = int(parts[3]), int(parts[4])
            index = int(parts[2])
        except ValueError:
            continue

        if parts[1] == "NS":
            axis, axis_name = 0, "x"
            letter = chr(ord("A") + index)
            veh = [f"{letter}{a}{letter}{b}", f"{letter}{b}{letter}{a}"]
            ribbon = ribbons.get(("NS", round(index * BLOCK, 1), side))
        else:
            axis, axis_name = 1, "y"
            veh = [
                f"{chr(ord('A') + a)}{index}{chr(ord('A') + b)}{index}",
                f"{chr(ord('A') + b)}{index}{chr(ord('A') + a)}{index}",
            ]
            ribbon = ribbons.get(("EW", round(index * BLOCK, 1), side))
        if ribbon is None:
            continue

        center = float(ribbon["center_sumo"])
        outer_half = 0.5 * float(ribbon["width_m"])
        span = carriageway(veh, axis)
        positive = side in ("R", "T")

        if positive:
            inner = (span[1] if span else center - outer_half) + CURB_MARGIN_M
            outer = center + outer_half - BUILDING_MARGIN_M
        else:
            inner = (span[0] if span else center + outer_half) - CURB_MARGIN_M
            outer = center - outer_half + BUILDING_MARGIN_M
        lo, hi = min(inner, outer), max(inner, outer)
        if hi - lo < 0.3:  # degenerate: fall back to a narrow band at the centre
            lo, hi = center - 0.15, center + 0.15
        bands[eid] = {"axis": axis_name, "min": round(lo, 3), "max": round(hi, 3)}

    path = OUT / "ped_bands.json"
    path.write_text(
        json.dumps({"cross_half_m": 0.5 * CROSS_WIDTH + 0.35, "bands": bands}, indent=1),
        encoding="utf-8",
    )
    widths = [b["max"] - b["min"] for b in bands.values()]
    print(
        f"wrote {path.name}: {len(bands)} sidewalk bands, "
        f"width {min(widths):.2f}-{max(widths):.2f} m",
        flush=True,
    )
    return path


def write_crossing_polys(crossings_meta: list[dict], nodes: dict[str, tuple[float, float]]) -> Path:
    """Bright zebra polys so crossings are obvious in sumo-gui."""
    polys: list[str] = []
    for c in crossings_meta:
        eid = c["id"]
        j = c.get("junction", "")
        across = c.get("across")
        side = c.get("side")
        # Parse junction like B1 → col=1 row=1
        if len(j) >= 2 and j[0].isalpha() and j[1:].isdigit():
            i = ord(j[0].upper()) - ord("A")
            row = int(j[1:])
        else:
            continue
        if across == "NS":
            a = pid(i, row, "L", side)
            b = pid(i, row, "R", side)
        else:
            a = pid(i, row, side, "B")
            b = pid(i, row, side, "T")
        if a not in nodes or b not in nodes:
            continue
        ax, ay = nodes[a]
        bx, by = nodes[b]
        if abs(bx - ax) >= abs(by - ay):
            y0, y1 = min(ay, by) - 1.4, max(ay, by) + 1.4
            x0, x1 = min(ax, bx), max(ax, bx)
        else:
            x0, x1 = min(ax, bx) - 1.4, max(ax, bx) + 1.4
            y0, y1 = min(ay, by), max(ay, by)
        shape = f"{x0:.2f},{y0:.2f} {x1:.2f},{y0:.2f} {x1:.2f},{y1:.2f} {x0:.2f},{y1:.2f}"
        polys.append(
            f'  <poly id="ZEBRA_{eid}" type="crossing" color="1.0,0.85,0.1" '
            f'fill="1" layer="1" shape="{shape}"/>'
        )

    path = OUT / "crossings.poly.xml"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<additional xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/additional_file.xsd">\n'
        + "\n".join(polys)
        + "\n</additional>\n",
        encoding="utf-8",
    )
    print(f"crossing polys={len(polys)} → {path.name}", flush=True)
    return path


def write_ped_routes() -> None:
    """Person flows on sidewalk edges (must exist after bake)."""
    routes = OUT / "ped_behaviors.rou.xml"
    routes.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<!-- Pedestrians on baked sidewalk graph (SW_*) with crossings (CR_*). -->
<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">

  <vTypeDistribution id="ped_pack">
    <vType id="elderly" vClass="pedestrian"
           desiredMaxSpeed="0.85" speedFactor="0.85"
           width="0.55" length="0.35" height="1.60"
           minGap="0.35" color="0.55,0.70,0.95"
           guiShape="pedestrian" probability="0.20"/>
    <vType id="adult" vClass="pedestrian"
           desiredMaxSpeed="1.35" speedFactor="1.0"
           width="0.50" length="0.30" height="1.75"
           minGap="0.25" color="0.15,0.90,1.00"
           guiShape="pedestrian" probability="0.50"/>
    <vType id="rushed" vClass="pedestrian"
           desiredMaxSpeed="1.90" speedFactor="1.25"
           width="0.45" length="0.25" height="1.80"
           minGap="0.18" color="1.00,0.40,0.15"
           guiShape="pedestrian" probability="0.20"/>
    <vType id="tourist" vClass="pedestrian"
           desiredMaxSpeed="1.05" speedFactor="0.90"
           width="0.55" length="0.40" height="1.70"
           minGap="0.40" color="0.95,0.85,0.20"
           guiShape="pedestrian" probability="0.10"/>
  </vTypeDistribution>

  <!-- Sorted by begin — natural mix: along-block walks + street crosses both ways -->
  <personFlow id="ped_cross_ns_b1" type="ped_pack" departPos="random" begin="0" end="3600" period="10">
    <walk from="SW_NS_1_0_1_L" to="SW_NS_1_0_1_R"/>
  </personFlow>
  <personFlow id="ped_cross_ns_b1r" type="ped_pack" departPos="random" begin="0.2" end="3600" period="11">
    <walk from="SW_NS_1_0_1_R" to="SW_NS_1_0_1_L"/>
  </personFlow>
  <personFlow id="ped_ns_b" type="ped_pack" departPos="random" begin="0.5" end="3600" period="13">
    <walk from="SW_NS_1_0_1_R" to="SW_NS_1_3_4_R"/>
  </personFlow>
  <personFlow id="ped_ns_br" type="ped_pack" departPos="random" begin="0.7" end="3600" period="15">
    <walk from="SW_NS_1_3_4_R" to="SW_NS_1_0_1_R"/>
  </personFlow>
  <personFlow id="ped_cross_ns_c2" type="ped_pack" departPos="random" begin="1" end="3600" period="11">
    <walk from="SW_NS_2_1_2_R" to="SW_NS_2_1_2_L"/>
  </personFlow>
  <personFlow id="ped_ew_1" type="ped_pack" departPos="random" begin="1.5" end="3600" period="14">
    <walk from="SW_EW_1_0_1_T" to="SW_EW_1_3_4_T"/>
  </personFlow>
  <personFlow id="ped_ew_1r" type="ped_pack" departPos="random" begin="1.7" end="3600" period="16">
    <walk from="SW_EW_1_3_4_T" to="SW_EW_1_0_1_T"/>
  </personFlow>
  <personFlow id="ped_cross_ew_1" type="ped_pack" departPos="random" begin="2" end="3600" period="10">
    <walk from="SW_EW_1_1_2_B" to="SW_EW_1_1_2_T"/>
  </personFlow>
  <personFlow id="ped_cross_ew_1r" type="ped_pack" departPos="random" begin="2.2" end="3600" period="11">
    <walk from="SW_EW_1_1_2_T" to="SW_EW_1_1_2_B"/>
  </personFlow>
  <personFlow id="ped_sn_c" type="ped_pack" departPos="random" begin="2.5" end="3600" period="15">
    <walk from="SW_NS_2_3_4_L" to="SW_NS_2_0_1_L"/>
  </personFlow>
  <personFlow id="ped_cross_ew_2" type="ped_pack" departPos="random" begin="3" end="3600" period="11">
    <walk from="SW_EW_2_2_3_T" to="SW_EW_2_2_3_B"/>
  </personFlow>
  <personFlow id="ped_we_2" type="ped_pack" departPos="random" begin="3.5" end="3600" period="15">
    <walk from="SW_EW_2_3_4_B" to="SW_EW_2_0_1_B"/>
  </personFlow>
  <personFlow id="ped_diag" type="ped_pack" departPos="random" begin="4" end="3600" period="14">
    <walk from="SW_NS_0_0_1_R" to="SW_EW_3_3_4_T"/>
  </personFlow>
  <personFlow id="ped_diag_r" type="ped_pack" departPos="random" begin="4.5" end="3600" period="16">
    <walk from="SW_EW_3_3_4_T" to="SW_NS_0_0_1_R"/>
  </personFlow>
</routes>
""",
        encoding="utf-8",
    )
    print(f"wrote {routes.name}", flush=True)


def main() -> None:
    if not (OUT / "sidewalks.json").is_file():
        raise SystemExit("missing sidewalks.json — run tools/extract_sidewalks_usd.py first")
    if not (OUT / "city_var.nod.xml").is_file() or not (OUT / "city_var.edg.xml").is_file():
        raise SystemExit("missing city_var.*.xml — run tools/build_sumo_varwidth.py first")
    if not (BIN / "netconvert").exists():
        raise SystemExit(f"netconvert missing: {BIN}")

    ribbons = load_ribbons()
    print(f"ribbons={len(ribbons)}", flush=True)

    veh_edg = OUT / "city_var_noped.edg.xml"
    rewrite_vehicle_edges_disallow_ped(OUT / "city_var.edg.xml", veh_edg)
    ped_nod, ped_edg, crossings_meta, sidewalk_meta, ped_nodes = build_ped_plain(ribbons)
    build_building_polys(ribbons)
    ped_con = write_ped_connections(ped_nodes, ped_edg)

    net = OUT / "city_grid.net.xml"
    cmd = [
        str(BIN / "netconvert"),
        f"--node-files={OUT / 'city_var.nod.xml'},{ped_nod}",
        f"--edge-files={veh_edg},{ped_edg}",
        f"--connection-files={ped_con}",
        "--no-turnarounds",
        "true",
        "--tls.guess",
        "true",
        "--tls.ignore-internal-junction-jam",
        "true",
        "--junctions.corner-detail",
        "0",
        "--default.junctions.radius",
        "0.5",
        "--geometry.remove",
        "false",
        "--offset.disable-normalization",
        "true",
        "-o",
        str(net),
    ]
    print("Running:", " ".join(cmd), flush=True)
    env = os.environ.copy()
    env["SUMO_HOME"] = str(SUMO_HOME)
    env["PATH"] = f"{BIN}:{env.get('PATH', '')}"
    subprocess.check_call(cmd, env=env)

    collapse_ped_junction_gaps(net, ped_nodes)
    sync_ped_tls_to_vehicle(net)
    write_ped_bands(net, ribbons)
    write_crossing_polys(crossings_meta, ped_nodes)
    write_ped_routes()

    (OUT / "city.sumocfg").write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <input>
    <net-file value="{net.name}"/>
    <route-files value="traffic.rou.xml,ped_behaviors.rou.xml"/>
    <additional-files value="buildings.poly.xml,crossings.poly.xml"/>
  </input>
  <time>
    <begin value="0"/>
    <end value="3600"/>
    <step-length value="0.05"/>
  </time>
  <processing>
    <collision.action value="warn"/>
    <time-to-teleport value="120"/>
    <emergencydecel.warning-threshold value="1.5"/>
    <pedestrian.model value="striping"/>
    <pedestrian.striping.dawdling value="0.35"/>
    <pedestrian.striping.stripe-width value="0.65"/>
  </processing>
  <report>
    <duration-log.disable value="true"/>
    <no-step-log value="true"/>
  </report>
</configuration>
""",
        encoding="utf-8",
    )

    (OUT / "ped_network.json").write_text(
        json.dumps(
            {"sidewalks": sidewalk_meta, "crossings": crossings_meta},
            indent=2,
        ),
        encoding="utf-8",
    )

    bounds = OUT / "sumo_bounds.txt"
    prev = bounds.read_text(encoding="utf-8") if bounds.exists() else ""
    lines = [ln for ln in prev.splitlines() if not ln.startswith("sidewalks_in_sumo")]
    lines.append("sidewalks_in_sumo=1")
    lines.append(f"ped_crossings={len(crossings_meta)}")
    lines.append("buildings=block_parcels_from_sidewalk_outers")
    bounds.write_text("\n".join(lines) + "\n", encoding="utf-8")

    sys.path.insert(0, str(SUMO_HOME / "tools"))
    import sumolib  # noqa: E402

    snet = sumolib.net.readNet(str(net))
    sw = [e for e in snet.getEdges() if e.getID().startswith("SW_")]
    cr = [e for e in snet.getEdges() if e.getID().startswith("CR_")]
    print(f"net edges sidewalk={len(sw)} crossing={len(cr)} total={len(snet.getEdges())}")
    # Sanity: sample walks exist
    for eid in ("SW_NS_1_0_1_R", "SW_EW_1_0_1_T", "CR_NS_1_1_T"):
        e = snet.getEdge(eid)
        print(f"  {eid}: {'OK' if e else 'MISSING'}")
    print("DONE", net)


if __name__ == "__main__":
    main()
