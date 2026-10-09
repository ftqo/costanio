
import bpy, bmesh, math, random
from mathutils import Vector

def mat(name, color, rough=0.62, metal=0.0, emit=None, strength=1.0, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m,'blend_method') else m.blend_method
    return m

def obj_from(name, verts, faces, m=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces); me.update()
    for p in me.polygons: p.use_smooth = False
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    if m: o.data.materials.append(m)
    return o

def box(name, size, loc=(0,0,0), rot=(0,0,0), m=None):
    sx, sy, sz = size[0]/2, size[1]/2, size[2]/2
    v = [(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),
         (-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]
    f = [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    o = obj_from(name, v, f, m)
    o.location = loc; o.rotation_euler = rot
    return o

def cyl(name, r=0.1, h=0.2, seg=8, loc=(0,0,0), rot=(0,0,0), m=None, cap=True):
    v, f = [], []
    for i in range(seg):
        a = i*math.tau/seg
        v.append((r*math.cos(a), r*math.sin(a), 0))
    for i in range(seg):
        a = i*math.tau/seg
        v.append((r*math.cos(a), r*math.sin(a), h))
    for i in range(seg):
        j = (i+1) % seg
        f.append((i, j, seg+j, seg+i))
    if cap:
        f.append(tuple(range(seg))[::-1]); f.append(tuple(range(seg, 2*seg)))
    o = obj_from(name, v, f, m)
    o.location = loc; o.rotation_euler = rot
    return o

def lathe(name, profile, seg=10, loc=(0,0,0), m=None):
    """profile = [(r,z), ...] bottom to top."""
    v, f = [], []
    for (r, z) in profile:
        for i in range(seg):
            a = i*math.tau/seg
            v.append((r*math.cos(a), r*math.sin(a), z))
    rows = len(profile)
    for k in range(rows-1):
        for i in range(seg):
            j = (i+1) % seg
            f.append((k*seg+i, k*seg+j, (k+1)*seg+j, (k+1)*seg+i))
    f.append(tuple(range(seg))[::-1])
    f.append(tuple(range((rows-1)*seg, rows*seg)))
    o = obj_from(name, v, f, m)
    o.location = loc
    return o

def jitter(o, amt=0.01, seed=0):
    rnd = random.Random(seed)
    for vv in o.data.vertices:
        vv.co.x += rnd.uniform(-amt, amt)
        vv.co.y += rnd.uniform(-amt, amt)
        vv.co.z += rnd.uniform(-amt, amt)

def bevel(o, w=0.01, seg=1):
    md = o.modifiers.new("Bevel", "BEVEL"); md.width = w; md.segments = seg
    md.limit_method = 'ANGLE'; md.angle_limit = math.radians(40)
    return md

def sun(name, rot, energy=4.0, color=(1,.95,.85), angle=2.0):
    d = bpy.data.lights.new(name, type='SUN'); d.energy = energy
    d.color = color; d.angle = math.radians(angle)
    o = bpy.data.objects.new(name, d); o.rotation_euler = rot
    bpy.context.collection.objects.link(o); return o

def area(name, loc, rot=(0,0,0), energy=50, size=2.0, color=(1,1,1), sy=None):
    d = bpy.data.lights.new(name, type='AREA'); d.energy = energy
    d.size = size
    if sy: d.shape = 'RECTANGLE'; d.size_y = sy
    d.color = color
    o = bpy.data.objects.new(name, d); o.location = loc; o.rotation_euler = rot
    bpy.context.collection.objects.link(o); return o

def point(name, loc, energy=20, color=(1,.6,.2), radius=0.05):
    d = bpy.data.lights.new(name, type='POINT'); d.energy = energy
    d.color = color; d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d); o.location = loc
    bpy.context.collection.objects.link(o); return o


def joinall(parts, name):
    """Join meshes into one object whose origin is the world origin.

    Without the transform_apply the result keeps parts[0]'s transform as its
    origin, and setting .location afterwards displaces the group by that much.
    """
    parts = [p for p in parts if p is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    return o
