#!/usr/bin/env python3
"""usd-structure-assessment Stage 1 for city_generator_large.usdc (no geometry arrays)."""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pxr import Usd, UsdGeom, UsdShade, Sdf

STAGE = "/media/disniekie/Working3/NEWCARLA/ov-citylab/assets/city/city_generator_large.usdc"
OUT = Path(__file__).resolve().parents[1]
OUT_JSON = OUT / "sa_report.json"


def scale_hint(mpu: float) -> str:
    if abs(mpu - 1.0) < 1e-6:
        return "meters"
    if abs(mpu - 0.01) < 1e-9:
        return "centimeters"
    if abs(mpu - 0.001) < 1e-9:
        return "millimeters"
    return "other"


def base_name(n: str) -> str:
    n = n.split("__")[0]
    n = re.sub(r"_\d{6,}$", "", n)
    return n


def main() -> None:
    stage = Usd.Stage.Open(STAGE)
    root = stage.GetPseudoRoot()
    mpu = UsdGeom.GetStageMetersPerUnit(stage)
    up = UsdGeom.GetStageUpAxis(stage)

    prim_count = 0
    mesh_count = 0
    material_count = 0
    point_instancer_count = 0
    geom_subset_count = 0
    instanceable_count = 0
    native_instance_count = 0
    prototype_count = len(list(stage.GetPrototypes()))
    ref_prims = 0
    payload_prims = 0
    type_counts: Counter[str] = Counter()
    mat_binds: Counter[str] = Counter()

    # PointInstancer instance totals
    pi_instance_total = 0
    pi_proto_targets = 0

    # Duplicate top-level name bases under city object (props still copied)
    city = stage.GetPrimAtPath("/World/City/City_Generator_2_0_Object")
    name_bases: Counter[str] = Counter()
    if city:
        for c in city.GetChildren():
            name_bases[base_name(c.GetName())] += 1

    for p in stage.Traverse():
        prim_count += 1
        tname = p.GetTypeName() or "Untyped"
        type_counts[tname] += 1
        if tname == "Mesh":
            mesh_count += 1
        elif tname == "Material":
            material_count += 1
        elif tname == "PointInstancer":
            point_instancer_count += 1
            pi = UsdGeom.PointInstancer(p)
            pos = pi.GetPositionsAttr().Get()
            if pos is not None:
                pi_instance_total += len(pos)
            protos = pi.GetPrototypesRel().GetTargets() if pi.GetPrototypesRel() else []
            pi_proto_targets += len(protos)
        elif tname == "GeomSubset":
            geom_subset_count += 1

        if p.IsInstanceable():
            instanceable_count += 1
        if p.IsInstance():
            native_instance_count += 1

        if p.HasAuthoredReferences():
            ref_prims += 1
        if p.HasAuthoredPayloads():
            payload_prims += 1

        # Material bindings (direct only)
        try:
            rel = UsdShade.MaterialBindingAPI(p).GetDirectBindingRel()
            if rel:
                for t in rel.GetTargets():
                    mat_binds[str(t)] += 1
        except Exception:
            pass

    layers = stage.GetLayerStack()
    layer_ids = [l.identifier for l in layers]

    # Hierarchy dedupe candidates among non-PI top-level copies
    top_candidates = []
    for b, n in name_bases.most_common(30):
        if n < 8:
            continue
        if b.startswith("PI_") or b == "InstancedBuildings" or b == "Plane":
            continue
        # skip already-instanced building bases (should be gone)
        if b.startswith("_1_NY") or b.startswith("NY_Trimm") or b.startswith("Curved_Building"):
            continue
        # estimate: each copy is typically 1 xform + 1 mesh (+ maybe few children)
        subtree = 2
        savings = max(0, (n - 1) * subtree)
        top_candidates.append(
            {
                "path_pattern": f"/World/City/City_Generator_2_0_Object/{b}_*",
                "subtree_prims": subtree,
                "copies": n,
                "estimated_prim_savings": savings,
            }
        )

    remaining_copy_instances = sum(c["copies"] for c in top_candidates)
    hierarchy_recommended = remaining_copy_instances >= 50

    # Instancing ratio: PI instances / (PI instances + remaining meshes roughly)
    instances = pi_instance_total + native_instance_count
    prototypes = max(point_instancer_count, pi_proto_targets, prototype_count)
    # candidates = remaining duplicated prop groups
    candidates = remaining_copy_instances
    ratio = (instances / (instances + mesh_count)) if (instances + mesh_count) else 0.0

    # Phase recommendation
    if hierarchy_recommended:
        phase_rec = "continue_to_hierarchy_dedupe_then_validators"
    else:
        phase_rec = "optimize_as_is_validators_then_mesh_ops"

    report = {
        "schemaVersion": "0.4.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workflow": "omniverse-usd-performance-tuning",
        "stage": {
            "identifier": STAGE,
            "rootLayer": stage.GetRootLayer().identifier,
            "defaultPrim": stage.GetDefaultPrim().GetPath().pathString if stage.GetDefaultPrim() else None,
            "upAxis": str(up),
            "metersPerUnit": float(mpu),
            "scale_hint": scale_hint(float(mpu)),
        },
        "asset_physical_context": {
            "metersPerUnit": float(mpu),
            "upAxis": str(up),
            "scale_hint": scale_hint(float(mpu)),
            "mesh_count": mesh_count,
        },
        "summary_counts": {
            "prim_count": prim_count,
            "mesh_count": mesh_count,
            "material_count": material_count,
            "prototype_count": prototypes,
            "instance_count": instances,
            "reference_count": ref_prims,
            "payload_count": payload_prims,
        },
        "composition": {
            "layers": len(layers),
            "references": ref_prims,
            "payloads": payload_prims,
            "counting_method": "prims_with_authored_arcs",
            "sublayers": layer_ids,
            "pointInstancers": point_instancer_count,
            "geomSubsets": geom_subset_count,
            "type_counts_top": type_counts.most_common(15),
        },
        "instancing": {
            "instances": instances,
            "prototypes": prototypes,
            "candidates": candidates,
            "ratio": round(ratio, 4),
            "point_instancer_count": point_instancer_count,
            "point_instancer_instances": pi_instance_total,
            "native_usd_instances": native_instance_count,
            "instanceable_prims": instanceable_count,
            "notes": [
                "Buildings already converted to UsdGeom.PointInstancer (57 PIs / ~7490 instances).",
                "Remaining candidates are street props / clutter with repeated name bases.",
            ],
        },
        "hierarchy_dedupe": {
            "recommended": hierarchy_recommended,
            "reason": (
                f"{remaining_copy_instances} remaining repeated prop/clutter copies outside PointInstancers; "
                "building kit already instanced."
                if hierarchy_recommended
                else "Building PointInstancers already cover the largest repeated hierarchies; residual prop copies are smaller."
            ),
            "top_candidates": top_candidates[:15],
        },
        "materials": {
            "unique_bound_paths": len(mat_binds),
            "top_bindings": mat_binds.most_common(12),
            "notes": [
                "High GeomSubset binding fan-out (glass/brick/interior) remains a draw-setup cost even with PointInstancers.",
            ],
        },
        "validation_scope": {
            "per_asset": [
                {
                    "path": STAGE,
                    "concepts": [
                        "perf_high_vertex_count",
                        "primvar_indexability",
                        "mesh_normals",
                        "extents",
                    ],
                }
            ],
            "cross_component_pairs": [],
            "skip": [
                "No omniverse:// remote payloads.",
                "Skip Kit FPS profile until user enables Kit→omniperf adjunct.",
            ],
        },
        "phase_recommendation": {
            "next": phase_rec,
            "intent_assumed": (
                "Isaac/webtest visual city streaming; preserve look; prefer load/FPS over per-part editability."
            ),
            "suggested_ops_priority": [
                "PointInstancer props (trash/boxes/seating/lamps) similar to buildings",
                "Usd Optimize: meshCleanup / optimizePrimvars on prototypes",
                "Reduce GeomSubset fan-out or simplify glass materials for streaming",
                "Optional: decimateMeshes only with mm tolerance if triangle budget needed",
            ],
            "do_not": [
                "Overwrite source city_generator_large.usdc without explicit approval",
                "Broad merge of dissimilar materials into one mesh",
            ],
        },
        "findings": [
            {
                "id": "buildings_already_instanced",
                "severity": "info",
                "summary": f"{point_instancer_count} PointInstancers with {pi_instance_total} instances",
            },
            {
                "id": "geomsubset_fanout",
                "severity": "high",
                "summary": f"{geom_subset_count} GeomSubsets; top binds glass/brick/interior still heavy",
            },
            {
                "id": "prop_copies_remain",
                "severity": "medium" if hierarchy_recommended else "low",
                "summary": f"{remaining_copy_instances} repeated prop-like top-level copies still uninstanced",
            },
            {
                "id": "monolithic_crate",
                "severity": "medium",
                "summary": "Single large .usdc root (no payloads/references); consider packaging prototypes as separate assets later",
            },
        ],
    }

    OUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "wrote": str(OUT_JSON),
                "prim_count": prim_count,
                "mesh_count": mesh_count,
                "pi": point_instancer_count,
                "pi_instances": pi_instance_total,
                "geom_subsets": geom_subset_count,
                "hierarchy_dedupe_recommended": hierarchy_recommended,
            }
        )
    )


if __name__ == "__main__":
    main()
