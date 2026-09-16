# KayKit traffic cars

These USDs are generated, not hand-edited. Rebuild them with:

    ~/isaacsim/python.sh tools/export_kaykit_cars.py
    ~/isaacsim/python.sh tools/verify_cars.py          # geometry conventions
    ~/isaacsim/python.sh tools/preview_cars.py         # contact sheet to eyeball

Source: `public/models/kaykit/gltf/car_*.gltf` — the same models the webtest
React view renders, which is why the twin and the web mock show matching
traffic.

**Upstream:** KayKit "City Builder Bits" (1.0) by Kay Lousberg,
<https://www.kaylousberg.com> — Creative Commons Zero (CC0). Full text in
`public/models/kaykit/LICENSE.txt`.

## Conventions these files must hold

`citylab.traffic` references `/Car` out of each file and applies only a
translate plus a yaw about Y, so the geometry itself has to be correct:

- Y-up, `metersPerUnit = 1`, default prim `/Car`
- Nose along **−X** (matches `_CAR_YAW_OFFSET_DEG = 180`)
- Centred on X/Z, tyres resting on `y = 0`
- One merged mesh per car sharing the single `citybits_texture.png` atlas

`verify_cars.py` checks every one of these; run it after any re-export.
