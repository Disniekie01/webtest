import json, sys
from pxr import Usd, UsdGeom

stage = Usd.Stage.Open(sys.argv[1])
plane = stage.GetPrimAtPath("/World/City/City_Generator_2_0_Object/Plane")
mesh = UsdGeom.Mesh(plane)
pts = list(mesh.GetPointsAttr().Get())
counts = list(mesh.GetFaceVertexCountsAttr().Get())
indices = list(mesh.GetFaceVertexIndicesAttr().Get())
face_starts = []
s = 0
for c in counts:
    face_starts.append(s)
    s += int(c)

def face_xy(fi):
    c = int(counts[fi])
    st = face_starts[fi]
    fpts = [pts[int(indices[st + k])] for k in range(c)]
    xs = [float(p[0]) for p in fpts]
    ys = [float(p[1]) for p in fpts]
    return min(xs), max(xs), min(ys), max(ys), 0.5 * (min(xs) + max(xs)), 0.5 * (min(ys) + max(ys))

curbs = []
for fi in map(int, plane.GetChild("CityGen_Curb").GetAttribute("indices").Get()):
    x0, x1, y0, y1, cx, cy = face_xy(fi)
    curbs.append((cx, cy, x0, x1, y0, y1))

ORIGIN = 80.0
BLOCK = 40.0
out = {}

def carriage_ns(line_usd, y0u, y1u):
    left, right = [], []
    y_lo, y_hi = min(y0u, y1u), max(y0u, y1u)
    for cx, cy, x0, x1, y0, y1 in curbs:
        if cy < y_lo - 1 or cy > y_hi + 1:
            continue
        if abs(cx - line_usd) > 12:
            continue
        (left if cx < line_usd else right).extend([x0, x1])
    if not left or not right:
        return None
    lo, hi = max(left), min(right)
    return hi - lo if hi > lo else None

def carriage_ew(line_usd, x0u, x1u):
    bot, top = [], []
    x_lo, x_hi = min(x0u, x1u), max(x0u, x1u)
    for cx, cy, x0, x1, y0, y1 in curbs:
        if cx < x_lo - 1 or cx > x_hi + 1:
            continue
        if abs(cy - line_usd) > 12:
            continue
        (bot if cy < line_usd else top).extend([y0, y1])
    if not bot or not top:
        return None
    lo, hi = max(bot), min(top)
    return hi - lo if hi > lo else None

for i in range(5):
    sx = i * BLOCK
    line_usd = sx - ORIGIN
    for j in range(4):
        sy0, sy1 = j * BLOCK, (j + 1) * BLOCK
        c = carriage_ns(line_usd, sy0 - ORIGIN, sy1 - ORIGIN)
        out[f"NS|{sx}|{sy0}|{sy1}"] = c

for j in range(5):
    sy = j * BLOCK
    line_usd = sy - ORIGIN
    for i in range(4):
        sx0, sx1 = i * BLOCK, (i + 1) * BLOCK
        c = carriage_ew(line_usd, sx0 - ORIGIN, sx1 - ORIGIN)
        out[f"EW|{sy}|{sx0}|{sx1}"] = c

print(json.dumps(out))
