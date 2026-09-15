#!/usr/bin/env python3
import json, os, sys, logging, re
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(stream=sys.stderr, force=True)

def changelog_version(root: Path) -> str:
    p = root / "CHANGELOG.md"
    if not p.exists():
        return "unknown"
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.match(r"^##\s*\[?([0-9]+\.[0-9]+\.[0-9]+)\]?", line)
        if m:
            return f"0.0.0+changelog:{m.group(1)}"
    return "unknown"

def main():
    so_root = Path(os.environ["USD_OPTIMIZE_ROOT"])
    from usd_optimize.core import UsdOptimizeCore
    ops = sorted(UsdOptimizeCore.getInstance().getOperations())
    so_ver = None
    try:
        import usd_optimize.core as c
        so_ver = getattr(c, "__version__", None)
    except Exception:
        so_ver = None
    if not so_ver or so_ver in ("0.0.0", "unknown"):
        so_ver = changelog_version(so_root)

    import omni.asset_validator as oav
    import importlib.metadata as md
    import usd_optimize.validators as V
    from omni.asset_validator import CategoryRuleRegistry
    before = len(list(CategoryRuleRegistry().rules))
    V.register_all()
    after = len(list(CategoryRuleRegistry().rules))

    # CUDA probe (best-effort)
    cuda = None
    try:
        import subprocess
        r = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=5)
        cuda = r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        cuda = None

    av_ver = md.version("usd-validation-nvidia")
    out = {
        "schemaVersion": "0.4.1",
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "runtime_route": "standalone",
        "status": "ready-standalone",
        "output_path": str(Path(__file__).resolve().parents[1]),
        "target_asset": "/media/disniekie/Working3/NEWCARLA/ov-citylab/assets/city/city_generator_large.usdc",
        "cuda_available": cuda,
        "usdOptimize": {
            "extension": "usd_optimize.core",
            "version": so_ver,
            "operationsAvailable": ops,
            "source": "standalone-package",
            "root": str(so_root),
            "operationCount": len(ops),
        },
        "assetValidator": {
            "package": "usd-validation-nvidia",
            "version": av_ver,
            "source": "pip",
            "oav_module_version": getattr(oav, "__version__", av_ver),
            "rules_before_register_all": before,
            "rules_after_register_all": after,
        },
        "python": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
            "venv": str(Path(sys.prefix)),
        },
        "kit": None,
        "runtime_context": {
            "kit": None,
            "usdOptimize": {
                "extension": "usd_optimize.core",
                "version": so_ver,
            },
            "assetValidator": {
                "package": "usd-validation-nvidia",
                "version": av_ver,
                "source": "pip",
            },
            "cuda_available": cuda,
        },
        "activate": str(so_root / "activate.sh"),
        "venv_activate": str(Path(sys.prefix) / "bin" / "activate"),
    }
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
