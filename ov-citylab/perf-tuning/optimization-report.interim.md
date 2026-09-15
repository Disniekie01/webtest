# Optimization interim report

- **Entry skill:** omniverse-usd-performance-tuning
- **Runtime:** standalone Usd Optimize 1.1.0 + usd-validation-nvidia 1.22.0
- **Workflow mode:** structural instancing pass (PointInstancer); source not overwritten
- **Generated:** 2026-09-15T19:49:56.693806+00:00

## Assets

| Role | Path |
|---|---|
| Source (untouched) | `ov-citylab/assets/city/city_generator_large.usdc` |
| Optimized output | `ov-citylab/perf-tuning/city_generator_large.optimized.usdc` |

## Baseline → after (quick profile)

| Metric | Baseline | After |
|---|---:|---:|
| Warm open (ms) | 33.49 | 21.29 |
| Traverse prims | 8178 | 2060 |
| Meshes | 2880 | 422 |
| PointInstancers | 57 | 81 |

## What ran

1. `profile-stage:baseline` (quick)
2. `usd-structure-assessment`
3. Hierarchy reuse: PointInstancer remaining ≥20-copy groups (fire escapes, grates, street props, roof clutter) → **24** new PIs / **2482** instances removed as unique prims
4. `profile-stage:after` (quick)

Buildings were already instanced earlier in-session (57 PIs / 7490 instances) on the source; this optimized file includes those plus prop/fire-escape instancing.

## Next recommended (needs approval)

1. Enable Kit→omniperf adjunct for real FPS/VRAM before/after in Isaac.
2. Usd Optimize on prototypes: `meshCleanup`, `optimizePrimvars` (lossless).
3. Reduce GeomSubset / glass cost for streaming (material simplification).
4. Optional payload split of prototype library for faster partial loads.

## Artifacts

- `setup-preflight.json`
- `baseline_profile.json` / `after_profile.json`
- `sa_report.json`
- `city_generator_large.optimized.usdc`

## Streaming pass (promoted to City Lab)

- Cheap glass/interior: PreviewSurface only (no OmniGlass MDL); glass opacity ~0.28
- GeomSubset merge on prototypes (concrete/frames/marble/wood → facade materials)
- `optimizePrimvars` + `computeExtents` on 81 prototypes (`meshCleanup` segfaults on this stage — skipped)
- `city_lab.usda` RTX dialed down: reflections 7→2 bounces, SPP 8→1, lens flares off, translucency cheaper
- Live path updated: `assets/city/city_generator_large.usdc` (46MB)
