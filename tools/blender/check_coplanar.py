"""Find coplanar (z-fighting) face pairs in a piece, and say which ones show.

    blender --background --factory-startup art/walls.blend \
        --python tools/blender/check_coplanar.py -- --prefix Wall_segment_ring

Two passes, because a coplanar pair is only a defect if a player can see it.

1. Detect. Every polygon of every evaluated mesh matching `--prefix` is taken in
   world space and reduced to a plane: unit normal (Newell, from the transformed
   points), sign-canonicalised so back-to-back faces land together, plus the
   signed offset. Planes are bucketed by quantised value, and each pair in a
   bucket is tested for real footprint overlap by clipping one triangle fan
   against the other in the plane's 2D frame. `bound_box` is not used: it is the
   axis-aligned corner box, not the geometry.

   Pairs within one object count: the city wall ships as one joined mesh.

2. Expose. From the centroid of each overlap, a ray is cast toward the camera at
   `--elev` degrees of elevation over `--az` azimuths. If the piece's own body
   is in the way the pair is `buried`; otherwise it is `EXPOSED` and will tear.

Reported in the blend's own units. Multiply by the runtime MODULE_SCALE for
world units (the wall ring is drawn at 2.0).
"""
import math, sys
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--")+1:]
def opt(n,d): return argv[argv.index(n)+1] if n in argv else d
PREFIX = opt("--prefix","Wall_segment_ring")
GAP  = float(opt("--gap","0.006"))
OLAP = float(opt("--olap","0.004"))
ELEV = math.radians(float(opt("--elev","56")))
NAZ  = int(opt("--az","16"))

# --- geometry gather ---
def faces_of(obj, dg):
    ev = obj.evaluated_get(dg); me = ev.to_mesh(); M = ev.matrix_world
    out=[]
    for p in me.polygons:
        pts=[M @ me.vertices[i].co.copy() for i in p.vertices]
        if len(pts)<3: continue
        n=Vector((0,0,0))
        for a,b in zip(pts, pts[1:]+pts[:1]):
            n.x+=(a.y-b.y)*(a.z+b.z); n.y+=(a.z-b.z)*(a.x+b.x); n.z+=(a.x-b.x)*(a.y+b.y)
        if n.length<1e-12: continue
        n.normalize()
        mat = obj.material_slots[p.material_index].material.name if obj.material_slots and obj.material_slots[p.material_index].material else "-"
        out.append({"obj":obj.name,"i":p.index,"n":n,"d":n.dot(pts[0]),"pts":pts,"mat":mat})
    ev.to_mesh_clear(); return out

def canon(n,d):
    for c in (n.x,n.y,n.z):
        if abs(c)>1e-9: return (n,d) if c>0 else (-n,-d)
    return (n,d)
def frame(n):
    a=Vector((1,0,0)) if abs(n.x)<0.9 else Vector((0,1,0))
    u=n.cross(a).normalized(); return u,n.cross(u).normalized()
def area2(p):
    s=0.0
    for i in range(len(p)):
        x1,y1=p[i]; x2,y2=p[(i+1)%len(p)]; s+=x1*y2-x2*y1
    return abs(s)/2
def sgn(p):
    s=0.0
    for i in range(len(p)):
        x1,y1=p[i]; x2,y2=p[(i+1)%len(p)]; s+=x1*y2-x2*y1
    return s
def clip(sub, cl):
    out=sub
    for i in range(len(cl)):
        if not out: return []
        a,b=cl[i],cl[(i+1)%len(cl)]
        ex,ey=b[0]-a[0],b[1]-a[1]
        def ins(p): return ex*(p[1]-a[1])-ey*(p[0]-a[0])>=-1e-12
        new=[]
        for j in range(len(out)):
            p,q=out[j],out[(j+1)%len(out)]
            ip,iq=ins(p),ins(q)
            if ip: new.append(p)
            if ip!=iq:
                d1=ex*(p[1]-a[1])-ey*(p[0]-a[0]); d2=ex*(q[1]-a[1])-ey*(q[0]-a[0])
                t=d1/(d1-d2) if d1!=d2 else 0
                new.append((p[0]+t*(q[0]-p[0]), p[1]+t*(q[1]-p[1])))
        out=new
    return out
def tris(p): return [(p[0],p[i],p[i+1]) for i in range(1,len(p)-1)]

def overlap(fa, fb, n):
    u,v=frame(n)
    A=[(u.dot(p),v.dot(p)) for p in fa]; B=[(u.dot(p),v.dot(p)) for p in fb]
    tot=0.0; cx=cy=0.0
    for ta in tris(A):
        for tb in tris(B):
            cb=list(tb) if sgn(list(tb))>0 else list(reversed(tb))
            poly=clip(list(ta),cb)
            a=area2(poly)
            if a>0:
                tot+=a
                mx=sum(p[0] for p in poly)/len(poly); my=sum(p[1] for p in poly)/len(poly)
                cx+=mx*a; cy+=my*a
    if tot<=0: return 0.0, None
    cx/=tot; cy/=tot
    return tot, u*cx + v*cy + n*(n.dot(fa[0]))

dg=bpy.context.evaluated_depsgraph_get()
objs=[o for o in bpy.data.objects if o.type=="MESH" and o.name.startswith(PREFIX)]
allf=[]
for o in sorted(objs,key=lambda x:x.name): allf+=faces_of(o,dg)

# BVH over every face of every matched object, for occlusion.
verts=[]; polys=[]
for f in allf:
    b=len(verts); verts+= [tuple(p) for p in f["pts"]]
    polys.append(tuple(range(b,b+len(f["pts"]))))
bvh=BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)

Q=GAP; buckets={}
for i,f in enumerate(allf):
    cn,cd=canon(f["n"],f["d"])
    buckets.setdefault((round(cn.x/0.02),round(cn.y/0.02),round(cn.z/0.02),round(cd/Q)),[]).append(i)
cands=set()
for (a,b,c,k),mem in buckets.items():
    near=[]
    for da in(-1,0,1):
        for db in(-1,0,1):
            for dc in(-1,0,1):
                for dk in(-1,0,1): near+=buckets.get((a+da,b+db,c+dc,k+dk),[])
    for i in mem:
        for j in near:
            if i<j: cands.add((i,j))

dirs=[]
for k in range(NAZ):
    az=2*math.pi*k/NAZ
    dirs.append((round(math.degrees(az)), Vector((math.cos(az)*math.cos(ELEV), math.sin(az)*math.cos(ELEV), math.sin(ELEV)))))

rows=[]
for i,j in cands:
    fi,fj=allf[i],allf[j]
    cni,cdi=canon(fi["n"],fi["d"]); cnj,cdj=canon(fj["n"],fj["d"])
    if cni.dot(cnj)<math.cos(math.radians(3)): continue
    g=abs(cdi-cdj)
    if g>GAP: continue
    a,c=overlap(fi["pts"],fj["pts"],cni)
    if c is None or math.sqrt(a)<OLAP: continue
    # Exposure: from the overlap centroid, can the camera see this plane?
    vis=[]
    for azdeg,dvec in dirs:
        if abs(cni.dot(dvec))<0.08: continue           # plane edge-on: no tearing area
        # Stand just clear of both faces, on the camera's side, and look toward
        # it. Any hit is an occluder.
        eps = g + 0.0006
        o = c + cni*(eps if cni.dot(dvec)>0 else -eps)
        hit = bvh.ray_cast(o, dvec, 100.0)
        if hit[0] is None:
            vis.append(azdeg)
    tilt=math.degrees(math.acos(min(1.0,abs(cni.z))))
    rows.append((math.sqrt(a),a,g,fi,fj,tilt,vis,c,cni))

rows.sort(key=lambda r:(-len(r[6]), -r[0]))
print(f"{'olap_len':>9s}{'area':>10s}{'gap':>9s} {'orient':<10s}{'vis_az':>7s}  faces                     materials")
for lin,a,g,fi,fj,tilt,vis,c,n in rows:
    orient="HORIZONTAL" if tilt<20 else ("vertical" if tilt>70 else "sloped")
    tag="EXPOSED" if vis else "buried "
    print(f"{lin:9.5f}{a:10.6f}{g:9.5f} {orient:<10s}{len(vis):5d}/{NAZ}  {tag} f{fi['i']}+f{fj['i']:<4d} {fi['mat']}/{fj['mat']}  at=({c.x:.4f},{c.y:.4f},{c.z:.4f}) n=({n.x:.2f},{n.y:.2f},{n.z:.2f}) az={vis}")
print(f"\nTOTAL {len(rows)} coplanar pairs, EXPOSED {sum(1 for r in rows if r[6])}")
