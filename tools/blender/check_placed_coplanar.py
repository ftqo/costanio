"""Runtime-composite coplanar check: the wall ring as Board3D actually draws it.

Reads the shipped glbs directly (no Blender), applies each node's baked
transform the way `subsetByPrefix` does, then seats and scales each asset the
way `seatOn(placements, SURFACE.gutter, assetBaseY(art), scale)` does, and runs
the same quantised-plane / real-footprint-overlap detector across the result.

    python3 runtime_coplanar.py

Three.js/glTF frame: Y up, board plane XZ. SAND_Y and the scales are read off
the frontend constants below and must be kept in step with them.
"""
import json, struct, math, itertools, os, sys

# Derived from this file's location, like build_board.py's REPO.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, "frontend", "public", "models") + os.sep
SAND_Y = 0.22          # SURFACE.gutter, gapGeometry.ts SAND_Y
WALL_SCALE = 2.0       # MODULE_SCALE.wall
CITY_SCALE = 2.0       # PIECE_SCALE.city
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3)   # coords.ts

GAP, OLAP, ANG = 0.006, 0.004, 3.0

CT = {5126: ("f", 4), 5123: ("H", 2), 5125: ("I", 4), 5122: ("h", 2), 5121: ("B", 1), 5120: ("b", 1)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

def load(path):
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    boff = 20 + jl + 8
    return j, d, boff

def acc(j, d, boff, i):
    a = j["accessors"][i]; v = j["bufferViews"][a["bufferView"]]
    fmt, sz = CT[a["componentType"]]; n = NC[a["type"]]
    off = boff + v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride") or sz * n
    out = []
    for k in range(a["count"]):
        base = off + k * stride
        out.append(struct.unpack_from("<" + fmt * n, d, base))
    return out

def node_matrix(n):
    t = n.get("translation", [0, 0, 0]); r = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    R = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    M = [[R[i][k] * s[k] for k in range(3)] + [t[i]] for i in range(3)]
    return M

def xf(M, p):
    return tuple(M[i][0]*p[0] + M[i][1]*p[1] + M[i][2]*p[2] + M[i][3] for i in range(3))

def subset(path, prefix):
    """Every triangle of every node whose name starts with `prefix`, with the
    node transform baked in, as subsetByPrefix produces."""
    j, d, boff = load(path)
    tris = []
    for n in j["nodes"]:
        if not n["name"].startswith(prefix) or "mesh" not in n:
            continue
        M = node_matrix(n)
        for p in j["meshes"][n["mesh"]]["primitives"]:
            pos = acc(j, d, boff, p["attributes"]["POSITION"])
            idx = [i[0] for i in acc(j, d, boff, p["indices"])]
            mat = j["materials"][p["material"]]["name"]
            for k in range(0, len(idx), 3):
                tris.append((n["name"], mat,
                             tuple(xf(M, pos[idx[k+t]]) for t in range(3))))
    return tris

def seat(tris, scale, at=(0.0, 0.0)):
    lo = min(min(v[1] for v in t[2]) for t in tris)
    y0 = SAND_Y - scale * lo
    return [(nm, mt, tuple((at[0] + scale*v[0], y0 + scale*v[1], at[1] + scale*v[2]) for v in vs))
            for nm, mt, vs in tris], lo

def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a, b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def norm(a):
    l = math.sqrt(dot(a, a));  return (a[0]/l, a[1]/l, a[2]/l) if l else (0, 0, 0)
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])

def canon(n, d):
    for c in n:
        if abs(c) > 1e-9:
            return (n, d) if c > 0 else (mul(n, -1), -d)
    return n, d

def frame(n):
    a = (1, 0, 0) if abs(n[0]) < 0.9 else (0, 1, 0)
    u = norm(cross(n, a));  return u, norm(cross(n, u))

def sgn(p):
    s = 0.0
    for i in range(len(p)):
        x1, y1 = p[i]; x2, y2 = p[(i+1) % len(p)]; s += x1*y2 - x2*y1
    return s

def clip(subj, cl):
    out = subj
    for i in range(len(cl)):
        if not out: return []
        a, b = cl[i], cl[(i+1) % len(cl)]
        ex, ey = b[0]-a[0], b[1]-a[1]
        new = []
        for k in range(len(out)):
            p, q = out[k], out[(k+1) % len(out)]
            dp = ex*(p[1]-a[1]) - ey*(p[0]-a[0]); dq = ex*(q[1]-a[1]) - ey*(q[0]-a[0])
            if dp >= -1e-12: new.append(p)
            if (dp >= -1e-12) != (dq >= -1e-12):
                t = dp/(dp-dq) if dp != dq else 0
                new.append((p[0]+t*(q[0]-p[0]), p[1]+t*(q[1]-p[1])))
        out = new
    return out

def area2(p):
    return abs(sgn(p))/2 if len(p) >= 3 else 0.0

def detect(tris, label, cross_only=True):
    planes = []
    for nm, mt, vs in tris:
        n = norm(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])))
        if n == (0, 0, 0): continue
        cn, cd = canon(n, dot(n, vs[0]))
        planes.append((nm, mt, vs, cn, cd))
    buckets = {}
    for i, (nm, mt, vs, cn, cd) in enumerate(planes):
        buckets.setdefault((round(cn[0]/0.02), round(cn[1]/0.02), round(cn[2]/0.02), round(cd/GAP)), []).append(i)
    seen = set(); hits = []
    for key, mem in buckets.items():
        near = []
        for da in (-1, 0, 1):
            for db in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    for dk in (-1, 0, 1):
                        near += buckets.get((key[0]+da, key[1]+db, key[2]+dc, key[3]+dk), [])
        for i in mem:
            for jj in near:
                if i >= jj or (i, jj) in seen: continue
                seen.add((i, jj))
                A, B = planes[i], planes[jj]
                if cross_only and A[0] == B[0]: continue
                if dot(A[3], B[3]) < math.cos(math.radians(ANG)): continue
                g = abs(A[4]-B[4])
                if g > GAP: continue
                u, v = frame(A[3])
                pa = [(dot(u, p), dot(v, p)) for p in A[2]]
                pb = [(dot(u, p), dot(v, p)) for p in B[2]]
                if sgn(pb) < 0: pb = list(reversed(pb))
                a = area2(clip(list(pa), pb))
                if a <= 0 or math.sqrt(a) < OLAP: continue
                tilt = math.degrees(math.acos(min(1.0, abs(A[3][1]))))
                hits.append((math.sqrt(a), a, g, A, B, tilt))
    hits.sort(key=lambda h: -h[0])
    print(f"\n=== {label}: {len(tris)} triangles, {len(hits)} coplanar pairs "
          f"(gap<={GAP} overlap>={OLAP}, cross_object={cross_only}) ===")
    for lin, a, g, A, B, tilt in hits[:40]:
        o = "HORIZONTAL" if tilt < 20 else ("vertical" if tilt > 70 else "sloped")
        print(f"  olap_len={lin:.5f} area={a:.6f} gap={g:.5f} {o:<10s} {A[0]}({A[1]}) vs {B[0]}({B[1]})")
    return hits

wall_raw = subset(MODELS + "walls.glb", "Wall_segment_ring_01")
city_raw = subset(MODELS + "pieces.glb", "City_A")
wall, wlo = seat(wall_raw, WALL_SCALE)
city, clo = seat(city_raw, CITY_SCALE)

def box(t):
    mn = [min(v[i] for _, _, vs in t for v in vs) for i in range(3)]
    mx = [max(v[i] for _, _, vs in t for v in vs) for i in range(3)]
    return mn, mx

wmn, wmx = box(wall); cmn, cmx = box(city)
print(f"WALL assetBaseY={wlo:.4f}  placed AABB min=({wmn[0]:.4f},{wmn[1]:.4f},{wmn[2]:.4f}) max=({wmx[0]:.4f},{wmx[1]:.4f},{wmx[2]:.4f})")
print(f"CITY assetBaseY={clo:.4f}  placed AABB min=({cmn[0]:.4f},{cmn[1]:.4f},{cmn[2]:.4f}) max=({cmx[0]:.4f},{cmx[1]:.4f},{cmx[2]:.4f})")
print(f"nearest two walled cities are {2*LATTICE_SIZE:.4f} apart; ring is {wmx[0]-wmn[0]:.4f} x {wmx[2]-wmn[2]:.4f} "
      f"-> ring-to-ring clearance {2*LATTICE_SIZE - (wmx[0]-wmn[0]):.4f}")

detect(wall + city, "wall ring vs the city it surrounds, as placed", cross_only=True)

# The board under the piece: the gutter fill's top face at SAND_Y.
ground = [("Gutter_sand", "Mat_Shore_sand",
           ((-4, SAND_Y, -4), (4, SAND_Y, -4), (4, SAND_Y, 4))),
          ("Gutter_sand", "Mat_Shore_sand",
           ((-4, SAND_Y, -4), (4, SAND_Y, 4), (-4, SAND_Y, 4)))]
detect(wall + ground, "wall ring vs the gutter surface it is seated on", cross_only=True)
