**How to run CityLab web test and services**

This document collects local developer steps to bring up the web UI, OVRTX MJPEG server, Yardline CV service, and IsaacSim (Kit) streaming container. It also shows Git LFS setup for large binaries.

Prereqs
 - Linux with sudo
 - Node.js (>=18) + npm
 - Python 3.11+
 - Git and Git LFS
 - Docker + NVIDIA Container Toolkit (for IsaacSim)

Frontend (Vite)
```
npm install
npm run dev
```

OVRTX (MJPEG)
```
cd ov-citylab
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/python ovrtx_stream_server.py
```

Yardline (CV service)
```
cd yardline
python3 -m venv .venv
.venv/bin/python3 -m pip install --upgrade pip
.venv/bin/pip install --no-cache-dir -e .
# If pip fails due to cache or disk issues:
.venv/bin/pip cache purge || true
.venv/bin/pip install --no-cache-dir -e .
.venv/bin/python -m uvicorn yardline.server:app --host 127.0.0.1 --port 8010 --log-level info
```

IsaacSim (Kit) — Docker
 - Run `ov-citylab/scripts/run_isaac6_streaming.sh` from the repo when Docker + NVIDIA runtime are available.
 - The script launches a container named `citylab-isaac6` and exposes Kit web viewer endpoints.

Git LFS
```
sudo apt install git-lfs
git lfs install
# Track common binary types
cat > .gitattributes <<'G'
*.usdz filter=lfs diff=lfs merge=lfs -text
*.usdc filter=lfs diff=lfs merge=lfs -text
*.usda filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
*.mp4 filter=lfs diff=lfs merge=lfs -text
*.mov filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
G
git add .gitattributes
git commit -m "Add Git LFS tracking for large assets"
```

Notes
- If you want me to commit these files now, say "commit" and I'll add and commit them.
