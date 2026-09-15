# City Lab (`webtest`)

3D smart-city story console (stories + comfort + Yardline-style mock CV).

---

## Setup on a new machine

### 1. Prerequisites

| Need | Version | Notes |
| --- | --- | --- |
| Node.js | 22.12+ (or 20.19+) | Vite 8 requires it; `node -v` to check |
| npm | 10+ | Ships with Node |
| Git | any | |
| Browser | Chrome/Chromium recommended | WebGL2 required |

A discrete GPU is not needed for the web app itself — only for the optional
Omniverse stream (see below).

### 2. Clone

```bash
git clone https://github.com/Disniekie01/webtest.git
cd webtest
```

### 3. Install dependencies

```bash
npm install
```

> **Heads-up on the NVIDIA dependency.** `@nvidia/omniverse-webrtc-streaming-library`
> resolves from NVIDIA's private registry, configured in the committed `.npmrc`:
>
> ```
> @nvidia:registry=https://edge.urm.nvidia.com:443/artifactory/api/npm/omniverse-client-npm/
> ```
>
> If that host is unreachable from the new machine, `npm install` fails on that
> one package. Nothing under `src/` imports it — the Omniverse stream is embedded
> as an iframe pointing at the viewer on `:8210` — so it is safe to drop:
>
> ```bash
> npm pkg delete 'dependencies.@nvidia/omniverse-webrtc-streaming-library'
> npm install
> ```

### 4. Run

```bash
npm run dev
```

Open **http://127.0.0.1:5175** (port is pinned in `vite.config.ts`, not Vite's
default 5173). First load pulls the ~68 MB Draco-compressed city GLB, so give it
a few seconds.

### 5. Build / lint

```bash
npm run build     # tsc -b && vite build
npm run preview   # serve the production build
npm run lint      # oxlint
```

That is everything needed for the standalone web app. The two sections below
cover optional pieces whose source lives **outside this repo**.

---

## Optional: re-syncing story data

Story JSON under `src/data/` is committed, so a fresh clone already has all
people, arcs, and the catalog. You only need this step if you are editing the
upstream YAML.

`npm run sync-stories` reads `../stories/` (a sibling of this repo in the
`NEWCARLA` tree, not included here) and regenerates:

- `src/data/catalog.json`
- `src/data/people/*.json`
- `src/data/people-index.json`
- `src/data/arcs.json`

Without that sibling directory the script exits with a missing-path error —
harmless, and safe to skip.

## Optional: Omniverse / Isaac Sim stream

The UI can embed a live Isaac Sim WebRTC stream of the city. That simulation
side is a separate project (`ov-citylab/`, a sibling of this repo) and is **not
part of this repository**. Without it the app still runs; the stream panel
simply reports the stream as unavailable.

When `ov-citylab/` is present, the dev server adds these endpoints and proxies:

| Route | Target | Purpose |
| --- | --- | --- |
| `/api/stream-status` | probes `49100`, `8210`, `8791` | Boot/readiness polling |
| `/api/release-stream-slot` | `ov-citylab/scripts/release_stream_slot.sh` | Free the single WebRTC client slot |
| `/api/open-chrome-stream` | local Chrome | Open the raw viewer |
| `/ov-stream` | `http://127.0.0.1:8210` | Same-origin embed of the stream |
| `/viewport`, `/kit-api` | `http://127.0.0.1:8790` | Kit viewport + API |
| `/stream-ctl` | `http://127.0.0.1:8791` | Kit stream control |

Ports in play: **5175** app, **8210** stream viewer, **49100** WebRTC signaling
(TCP), **47998** media (UDP), **8791** Kit control. Running it needs an NVIDIA
GPU, Docker with the NVIDIA container runtime, and access to the Isaac Sim image.

---

## City look

**Active:** [The City Generator 2.4](https://superhivemarket.com/products/the-city-generator) district
Path: `public/models/citygen/city_generator_v24.glb` (~68 MB Draco)

Regenerating the GLB needs Blender 4.3+ plus the City Generator addon. Neither
is committed (both are gitignored), so this is a local-only workflow:

```bash
./tools/blender-4.3.2-linux-x64/blender -b --python tools/generate_city_vfxmed.py
```

The Quaternius Downtown kit (`public/models/downtown/`) is a fallback and is
also excluded from git.

## What is not in this repo

Kept out deliberately to stay under GitHub's size limits:

- `node_modules/`, `dist/`
- Asset archives (`*.zip`, `*.usdz`) — City Generator, Downtown MegaKit, FBX packs
- Bundled Blender installs and addons under `tools/`
- The `ov-citylab/` simulation project and the `stories/` YAML source
