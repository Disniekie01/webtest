# City Lab (`webtest`)

3D smart-city story console (stories + comfort + Yardline-style mock CV).

## City look

**Active:** [The City Generator 2.4](https://superhivemarket.com/products/the-city-generator) district  
Path: `public/models/citygen/city_generator_v24.glb` (~68 MB Draco)

Regenerate (needs Blender 4.3+):

```bash
./tools/blender-4.3.2-linux-x64/blender -b --python tools/generate_city_vfxmed.py
```

Quaternius Downtown remains under `public/models/downtown/` as a fallback kit.

## Run

```bash
npm install && npm run sync-stories && npm run dev
```

http://127.0.0.1:5173 — first load pulls the city GLB (may take a few seconds).
