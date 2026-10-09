"""Shared low-poly kit for the card scenes.

Not a scene generator: each card is its own `scenes/<id>.blend`. This holds
what several cards must build identically so they look like one set: a horse,
a rider, a straight hex-angle road, a crenellated wall, the render rig and the
sun solver.

Metres throughout. Ground is z=0. +Y runs away from the camera unless a card says
otherwise. Flat shading everywhere: round things get more sides, never softer
normals.
"""

import math
import random

import bpy
from mathutils import Vector

D2R = math.radians
TAU = math.tau


# ------------------------------------------------------------------ materials

def M(name, color, rough=0.92, spec=0.13, metal=0.0, emit=None, emit_strength=0.0):
    """A flat low-poly surface. Specular IOR Level is never left at Blender's 0.5.

    `emit` is for surfaces the lighting cannot separate from the sky, mainly
    distant cloud. A small constant (0.3 to 0.5) does it; keep it under 1.
    """
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Specular IOR Level"].default_value = spec
    b.inputs["Emission Color"].default_value = (*(emit or color), 1)
    b.inputs["Emission Strength"].default_value = emit_strength
    return m


def M_emit(name, color, strength=2.0):
    """A saturated hue at low strength. AgX whitens anything bright."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs["Surface"])
    return m


# ----------------------------------------------------------------- primitives

def _new(name, verts, faces, m=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = False
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    if m:
        o.data.materials.append(m)
    return o


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), m=None):
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = rot
    return o


def quad(name, corners, m=None):
    """A flat polygon from an explicit ring of points. The workhorse for roads."""
    return _new(name, list(corners), [tuple(range(len(corners)))], m)


def prism(name, ring, h, loc=(0, 0, 0), rot=(0, 0, 0), m=None):
    """Extrude a 2D ring [(x, y), ...] upward by h."""
    n = len(ring)
    v = [(x, y, 0) for (x, y) in ring] + [(x, y, h) for (x, y) in ring]
    f = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = rot
    return o


def cyl(name, r=0.1, h=0.2, seg=8, loc=(0, 0, 0), rot=(0, 0, 0), m=None, r2=None):
    r2 = r if r2 is None else r2
    ring = [(r * math.cos(i * TAU / seg), r * math.sin(i * TAU / seg)) for i in range(seg)]
    top = [(r2 * math.cos(i * TAU / seg), r2 * math.sin(i * TAU / seg)) for i in range(seg)]
    v = [(x, y, 0) for (x, y) in ring] + [(x, y, h) for (x, y) in top]
    f = [tuple(range(seg))[::-1], tuple(range(seg, 2 * seg))]
    for i in range(seg):
        j = (i + 1) % seg
        f.append((i, j, seg + j, seg + i))
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = rot
    return o


def lathe(name, profile, seg=10, loc=(0, 0, 0), rot=(0, 0, 0), m=None):
    """Revolve a [(r, z), ...] profile, bottom to top."""
    v, f = [], []
    for (r, z) in profile:
        for i in range(seg):
            a = i * TAU / seg
            v.append((r * math.cos(a), r * math.sin(a), z))
    rows = len(profile)
    for k in range(rows - 1):
        for i in range(seg):
            j = (i + 1) % seg
            f.append((k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i))
    f.append(tuple(range(seg))[::-1])
    f.append(tuple(range((rows - 1) * seg, rows * seg)))
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = rot
    return o


def tube(name, p0, p1, r0, r1=None, seg=7, m=None):
    """A tapered cylinder from p0 to p1, both world points.

    Used for every animal's neck and head: a limb that changes direction needs
    a real axis, which an ellipsoid only gives when one radius dominates.
    """
    r1 = r0 if r1 is None else r1
    a = Vector(p0)
    b = Vector(p1)
    d = b - a
    L = d.length
    o = cyl(name, r=r0, h=L, seg=seg, m=m, r2=r1)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    o.location = a
    return o


def ellipsoid(name, radii, loc=(0, 0, 0), rot=(0, 0, 0), m=None, seg=10, rings=6):
    """A flat-shaded blob. The building unit for every animal and figure here."""
    rx, ry, rz = radii
    v = [(0, 0, -rz)]
    for k in range(1, rings):
        phi = math.pi * k / rings
        z = -math.cos(phi)
        s = math.sin(phi)
        for i in range(seg):
            a = i * TAU / seg
            v.append((rx * s * math.cos(a), ry * s * math.sin(a), rz * z))
    v.append((0, 0, rz))
    f = []
    for i in range(seg):
        f.append((0, 1 + (i + 1) % seg, 1 + i))
    for k in range(rings - 2):
        b0 = 1 + k * seg
        b1 = 1 + (k + 1) * seg
        for i in range(seg):
            j = (i + 1) % seg
            f.append((b0 + i, b0 + j, b1 + j, b1 + i))
    top = len(v) - 1
    b0 = 1 + (rings - 2) * seg
    for i in range(seg):
        f.append((b0 + i, b0 + (i + 1) % seg, top))
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = rot
    return o


def jitter(o, amt=0.01, seed=0):
    rnd = random.Random(seed)
    for vv in o.data.vertices:
        vv.co.x += rnd.uniform(-amt, amt)
        vv.co.y += rnd.uniform(-amt, amt)
        vv.co.z += rnd.uniform(-amt, amt)


def joinall(parts, name, m=None):
    """Join meshes into one object whose origin is the world origin.

    transform_apply is required: without it the result keeps parts[0]'s
    transform as its origin and a later .location displaces the whole group.
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
    if m:
        o.data.materials.clear()
        o.data.materials.append(m)
    return o


# ---------------------------------------------------------------------- roads

def road(name, a, b, width, m, kerb_m=None, kerb_w=0.28, kerb_h=0.13, z=0.02):
    """A straight road segment from a=(x, y) to b=(x, y). Hex lattice: no curves.

    Returns the joined object. Optional kerbs give a raking light an edge to
    describe the road's straightness.
    """
    ax, ay = a
    bx, by = b
    d = Vector((bx - ax, by - ay))
    L = d.length
    d.normalize()
    n = Vector((-d.y, d.x))
    hw = width / 2
    parts = []
    c = [(ax + n.x * hw, ay + n.y * hw, z), (bx + n.x * hw, by + n.y * hw, z),
         (bx - n.x * hw, by - n.y * hw, z), (ax - n.x * hw, ay - n.y * hw, z)]
    parts.append(quad(name + "_surf", c, m))
    if kerb_m is not None:
        for side in (1, -1):
            off = hw + kerb_w / 2
            cx, cy = (ax + bx) / 2 + n.x * off * side, (ay + by) / 2 + n.y * off * side
            k = box(name + "_kerb%d" % side, (kerb_w, L, kerb_h),
                    loc=(cx, cy, kerb_h / 2), rot=(0, 0, math.atan2(d.y, d.x) - math.pi / 2), m=kerb_m)
            parts.append(k)
    return joinall(parts, name)


# ----------------------------------------------------------------- stonework

def crenellated_wall(name, a, b, thick, h, m, merlon_w=0.9, gap=0.7, merlon_h=0.85):
    """A straight wall with a real merlon-and-embrasure top.

    Real relief, so the wall's form reads with or without shadows.
    """
    ax, ay = a
    bx, by = b
    d = Vector((bx - ax, by - ay))
    L = d.length
    d.normalize()
    ang = math.atan2(d.y, d.x)
    parts = [box(name + "_body", (thick, L, h),
                 loc=((ax + bx) / 2, (ay + by) / 2, h / 2),
                 rot=(0, 0, ang - math.pi / 2), m=m)]
    step = merlon_w + gap
    count = max(1, int(L // step))
    start = (L - (count * step - gap)) / 2
    for i in range(count):
        t = start + i * step + merlon_w / 2
        px, py = ax + d.x * t, ay + d.y * t
        parts.append(box(name + "_m%d" % i, (thick, merlon_w, merlon_h),
                         loc=(px, py, h + merlon_h / 2),
                         rot=(0, 0, ang - math.pi / 2), m=m))
    return joinall(parts, name)


def course_stones(name, a, b, h, thick, m, course=0.42, seed=1, relief=0.05):
    """A band of individually offset stone courses, for a wall the camera is near.

    Each course is a box pushed in or out by a few centimetres to catch an edge
    highlight, which still reads under flat overcast.
    """
    ax, ay = a
    bx, by = b
    d = Vector((bx - ax, by - ay))
    L = d.length
    d.normalize()
    ang = math.atan2(d.y, d.x)
    rnd = random.Random(seed)
    parts = []
    n = max(1, int(h / course))
    for i in range(n):
        t = thick + rnd.uniform(-relief, relief)
        parts.append(box(name + "_c%d" % i, (t, L, course * 0.94),
                         loc=((ax + bx) / 2, (ay + by) / 2, course * (i + 0.5)),
                         rot=(0, 0, ang - math.pi / 2), m=m))
    return joinall(parts, name)


def arch(name, span, rise, depth, thick, m, seg=9, loc=(0, 0, 0), rot=(0, 0, 0)):
    """A voussoir ring over a span. Courses are ~0.155 m fine; this is the ring."""
    parts = []
    r = span / 2
    for i in range(seg):
        a0 = math.pi * i / seg
        a1 = math.pi * (i + 1) / seg
        am = (a0 + a1) / 2
        w = r * (a1 - a0) * 1.06
        cx = r * math.cos(am)
        cz = rise * math.sin(am)
        b = box(name + "_v%d" % i, (w, depth, thick),
                loc=(cx, 0, cz), rot=(0, am - math.pi / 2, 0), m=m)
        parts.append(b)
    o = joinall(parts, name)
    o.location = loc
    o.rotation_euler = rot
    return o


# ------------------------------------------------------------------- figures

def horse(name, loc, yaw, m_body, m_mane, m_hoof, pose="stand", scale=1.0, seed=3):
    """A low-poly horse: ellipsoid skeleton, joined, rotated once at the end.

    pose: "stand" | "blown" (head down, weight back) | "walk" | "turn" (head
    round toward the near shoulder) | "lean" (driving forward).

    Built nose along -Y, then yawed once. Withers at z=1.62, elbow at 1.05,
    hoof on z=0: props on these cards are scaled against these, so keep them.

    The barrel is narrow (0.33 in x against 0.86 in y) and the legs long enough
    to show daylight under the belly, which is what makes it read as a horse.
    """
    parts = []
    B = m_body
    parts.append(ellipsoid(name + "_barrel", (0.305, 0.78, 0.405), loc=(0, 0.05, 1.16), m=B))
    parts.append(ellipsoid(name + "_chest", (0.335, 0.38, 0.40), loc=(0, -0.70, 1.12), m=B))
    parts.append(ellipsoid(name + "_rump", (0.345, 0.44, 0.44), loc=(0, 0.80, 1.20), m=B))
    parts.append(ellipsoid(name + "_shoulder", (0.285, 0.32, 0.33), loc=(0, -0.48, 1.32), m=B))

    # Neck and head as a chain of axes: withers -> poll is the crest, poll ->
    # muzzle the head, always angled down off the crest.
    withers = Vector((0.0, -0.55, 1.56))
    if pose == "blown":
        poll = Vector((0.0, -1.02, 1.34))
        muzzle = poll + Vector((0.0, -0.10, -0.46))
    elif pose == "turn":
        poll = Vector((0.20, -0.94, 2.02))
        muzzle = poll + Vector((0.30, -0.30, -0.30))
    elif pose == "lean":
        poll = Vector((0.0, -1.06, 1.92))
        muzzle = poll + Vector((0.0, -0.40, -0.28))
    else:
        poll = Vector((0.0, -1.00, 2.05))
        muzzle = poll + Vector((0.0, -0.32, -0.39))

    neck_v = poll - withers
    parts.append(tube(name + "_neck", withers - neck_v * 0.16, poll, 0.235, 0.130, seg=7, m=B))
    parts.append(tube(name + "_head", poll + (muzzle - poll) * -0.10, muzzle,
                      0.135, 0.083, seg=7, m=B))
    parts.append(ellipsoid(name + "_cheek", (0.105, 0.135, 0.115),
                           loc=tuple(poll + (muzzle - poll) * 0.30), m=B))
    parts.append(ellipsoid(name + "_muzzle", (0.075, 0.080, 0.072),
                           loc=tuple(muzzle), m=B))
    hd = (muzzle - poll).normalized()
    side = Vector((-hd.y, hd.x, 0.0)).normalized()
    for sgn in (-1, 1):
        parts.append(box(name + "_ear%d" % sgn, (0.055, 0.05, 0.155),
                         loc=tuple(poll + side * (0.062 * sgn) + Vector((0, 0.02, 0.10))),
                         rot=(D2R(-10), D2R(10 * sgn), 0), m=B))
    # The crest sits on the neck's upper-rear normal; offset in world Z it
    # stands off a rising neck as a flat fin.
    nd = neck_v.normalized()
    crest = Vector((0.0, nd.z, -nd.y)) if nd.y < 0 else Vector((0.0, -nd.z, nd.y))
    for i in range(5):
        t = 0.08 + i * 0.20
        pmn = withers + neck_v * t + crest * 0.15
        parts.append(box(name + "_mane%d" % i, (0.068, 0.19, 0.15),
                         loc=tuple(pmn),
                         rot=(math.atan2(-neck_v.y, neck_v.z), 0, 0), m=m_mane))
    parts.append(ellipsoid(name + "_tail", (0.085, 0.11, 0.40),
                           loc=(0, 1.14, 1.02), rot=(D2R(-22), 0, 0), m=m_mane))

    # Legs: upper pitches from the body, lower hangs from where the upper ends,
    # hoof on the ground.
    if pose == "walk":
        pitch = {(-1, 0): 15, (1, 0): -11, (-1, 1): -13, (1, 1): 11}
    elif pose == "turn":
        pitch = {(-1, 0): -30, (1, 0): 5, (-1, 1): 4, (1, 1): -4}
    elif pose == "lean":
        pitch = {(-1, 0): 22, (1, 0): 6, (-1, 1): -18, (1, 1): -6}
    elif pose == "blown":
        pitch = {(-1, 0): 7, (1, 0): -5, (-1, 1): -8, (1, 1): 6}
    else:
        pitch = {(-1, 0): 3, (1, 0): -3, (-1, 1): -3, (1, 1): 3}
    for sx in (-1, 1):
        for fy, y0, top in ((0, -0.58, 1.06), (1, 0.76, 1.12)):
            p = D2R(pitch[(sx, fy)])
            L1 = 0.50
            x = 0.255 * sx
            y1 = y0 + math.sin(p) * L1
            z1 = top - math.cos(p) * L1
            parts.append(cyl(name + "_lu%d%d" % (sx, fy), r=0.115, h=L1, seg=6,
                             loc=(x, y0, top), rot=(math.pi - p, 0, 0), m=B, r2=0.082))
            L2 = z1 - 0.115
            parts.append(cyl(name + "_ll%d%d" % (sx, fy), r=0.070, h=L2, seg=6,
                             loc=(x, y1, z1), rot=(math.pi, 0, 0), m=B, r2=0.052))
            parts.append(cyl(name + "_h%d%d" % (sx, fy), r=0.082, h=0.115, seg=6,
                             loc=(x, y1, 0.0), m=m_hoof))

    o = joinall(parts, name)
    jitter(o, 0.006, seed)
    o.scale = (scale, scale, scale)
    o.rotation_euler = (0, 0, yaw)
    o.location = loc
    return o


def saddle(name, loc, yaw, m_leather, scale=1.0):
    """A saddle and a girth, so horse and rider read as one group."""
    parts = [ellipsoid(name + "_seat", (0.28, 0.42, 0.14), loc=(0, 0.02, 1.60), m=m_leather),
             box(name + "_cantle", (0.30, 0.10, 0.18), loc=(0, 0.36, 1.66), m=m_leather),
             box(name + "_pommel", (0.24, 0.09, 0.15), loc=(0, -0.34, 1.64), m=m_leather)]
    for s in (-1, 1):
        parts.append(box(name + "_flap%d" % s, (0.06, 0.44, 0.34),
                         loc=(0.30 * s, 0.02, 1.40), m=m_leather))
        parts.append(box(name + "_girth%d" % s, (0.05, 0.13, 0.34),
                         loc=(0.31 * s, -0.18, 1.10), m=m_leather))
    o = joinall(parts, name)
    o.scale = (scale, scale, scale)
    o.rotation_euler = (0, 0, yaw)
    o.location = loc
    return o


def rider(name, loc, yaw, m_cloth, m_skin, m_metal, pose="seated", scale=1.0,
          helmet=True, seed=7):
    """A low-poly rider, origin at the saddle seat.

    pose: "seated" | "mounting" (one leg swung high, body pitched forward over
    the pommel, both arms down and forward) | "lean".

    The cloak is a lathe at a radius the body never reaches, not a scaled torso.
    """
    parts = []
    if pose == "mounting":
        lean, twist = D2R(42), D2R(-18)
    elif pose == "lean":
        lean, twist = D2R(20), 0.0
    else:
        lean, twist = D2R(6), 0.0
    parts.append(ellipsoid(name + "_hips", (0.185, 0.175, 0.135), loc=(0, 0.02, 0.10), m=m_cloth))
    torso = ellipsoid(name + "_torso", (0.175, 0.145, 0.30),
                      loc=(0, 0.02 - math.sin(lean) * 0.22, 0.40),
                      rot=(lean, 0, twist), m=m_cloth)
    parts.append(torso)
    hx = -math.sin(lean) * 0.52
    parts.append(ellipsoid(name + "_neck", (0.055, 0.055, 0.07),
                           loc=(0, 0.02 + hx * 0.86, 0.66), m=m_skin))
    parts.append(ellipsoid(name + "_head", (0.105, 0.112, 0.125),
                           loc=(0, 0.02 + hx, 0.78), m=m_skin))
    if helmet:
        parts.append(lathe(name + "_helm",
                           [(0.0, 0.20), (0.075, 0.155), (0.118, 0.055), (0.128, 0.0), (0.128, -0.03)],
                           seg=9, loc=(0, 0.02 + hx, 0.755), m=m_metal))
        parts.append(box(name + "_nasal", (0.035, 0.05, 0.13),
                         loc=(0, 0.02 + hx - 0.105, 0.775), m=m_metal))
    cloak = lathe(name + "_cloak", [(0.26, -0.10), (0.235, 0.10), (0.185, 0.32), (0.135, 0.50)],
                  seg=9, loc=(0, 0.09, 0.06), m=m_cloth)
    parts.append(cloak)

    # thighs forward and down over the flap, shins hanging to the stirrup
    if pose == "mounting":
        legs = {-1: (D2R(-150), 0.34), 1: (D2R(-30), -0.06)}
    else:
        legs = {-1: (D2R(-52), 0.0), 1: (D2R(-52), 0.0)}
    for s, (p, lift) in legs.items():
        parts.append(cyl(name + "_thigh%d" % s, r=0.082, h=0.36, seg=6,
                         loc=(0.135 * s, 0.02, 0.06 + lift), rot=(math.pi / 2 + p, 0, 0),
                         m=m_cloth, r2=0.068))
        ty = 0.02 - math.sin(p + math.pi / 2) * 0.0
        parts.append(cyl(name + "_shin%d" % s, r=0.062, h=0.40, seg=6,
                         loc=(0.175 * s, ty - 0.28, 0.02 + lift), rot=(math.pi, 0, 0),
                         m=m_cloth, r2=0.050))
    arm_p = D2R(-86) if pose == "mounting" else D2R(-30)
    for s in (-1, 1):
        parts.append(cyl(name + "_arm%d" % s, r=0.060, h=0.38, seg=6,
                         loc=(0.165 * s, 0.02 + hx * 0.7, 0.56), rot=(math.pi + arm_p, 0, 0),
                         m=m_cloth, r2=0.048))
    o = joinall(parts, name)
    jitter(o, 0.004, seed)
    o.scale = (scale, scale, scale)
    o.rotation_euler = (0, 0, yaw)
    o.location = loc
    return o


def banner(name, loc, w, h, m, yaw=0.0, sag=0.10, seg=6):
    """A hanging banner with a little wind in it, built as a strip of quads."""
    v, f = [], []
    for i in range(seg + 1):
        t = i / seg
        y = (t - 0.5) * w
        bow = math.sin(t * math.pi) * sag
        v.append((bow, y, 0))
        v.append((bow * 0.4, y, -h))
    for i in range(seg):
        a = 2 * i
        f.append((a, a + 2, a + 3, a + 1))
    o = _new(name, v, f, m)
    o.location = loc
    o.rotation_euler = (0, 0, yaw)
    return o


def horse_unified(name, pos, az, m_body, m_mane, m_hoof, pose="stand", seed=3, scale=1.0):
    """A low-poly horse that reads as one animal. Prefer this over `horse`.

    `horse` stays unchanged because raiders_muster and raiders_swift_rider were
    rendered from it. Its barrel and rump read as two lobes in three-quarter
    view, and its muzzle ends on a flat tube cap.

    Compared with `horse` it has:
      - a rump no wider than the barrel, plus a topline ellipsoid bridging the
        two, so the back is one continuous line and the animal is one mass;
      - a neck with a real base (r 0.275 at the shoulder against the kit's
        0.235) so it grows out of the shoulder instead of being stuck on it;
      - a head that is jowl, then a tapered face, then a rounded muzzle;
      - knee, hock and fetlock joints, so the legs are not plain cones.

    Built nose along -Y and yawed once at the end. Withers 1.60, elbow 1.05,
    hoof 0 (props are scaled against these). `az` is the world azimuth the nose
    points at; the object yaw is 180 - az, because a rotation of theta sends
    (0,-1) to (sin theta, -cos theta).
    """
    B = m_body
    parts = []
    # --- barrel: one long mass, the rump no prouder than it, and a topline
    # ellipsoid over the join so the back reads as one line.
    parts.append(ellipsoid(name + "_barrel", (0.300, 0.88, 0.400), loc=(0, 0.04, 1.17),
                             m=B, seg=11, rings=6))
    parts.append(ellipsoid(name + "_girth", (0.316, 0.40, 0.412), loc=(0, -0.44, 1.15),
                             m=B, seg=11, rings=6))
    parts.append(ellipsoid(name + "_rump", (0.312, 0.46, 0.410), loc=(0, 0.72, 1.20),
                             m=B, seg=11, rings=6))
    parts.append(ellipsoid(name + "_back", (0.258, 0.72, 0.235), loc=(0, 0.30, 1.44),
                             m=B, seg=10, rings=5))
    parts.append(ellipsoid(name + "_croup", (0.246, 0.30, 0.245), loc=(0, 0.66, 1.44),
                             m=B, seg=10, rings=5))
    parts.append(ellipsoid(name + "_shoulder", (0.278, 0.36, 0.360), loc=(0, -0.50, 1.36),
                             m=B, seg=10, rings=5))

    withers = Vector((0.0, -0.58, 1.54))
    if pose == "blown":
        poll = Vector((0.0, -1.10, 1.18))
        muzzle = poll + Vector((0.0, -0.22, -0.52))
    elif pose == "turn":
        poll = Vector((0.22, -0.96, 2.00))
        muzzle = poll + Vector((0.30, -0.26, -0.34))
    else:
        poll = Vector((0.0, -1.02, 2.03))
        muzzle = poll + Vector((0.0, -0.34, -0.38))

    nv = poll - withers
    parts.append(tube(name + "_neck", withers - nv * 0.20, poll, 0.275, 0.118,
                        seg=8, m=B))
    hd = (muzzle - poll).normalized()
    # jowl, face, and a rounded muzzle (a tube alone ends on a flat cap)
    parts.append(ellipsoid(name + "_jowl", (0.118, 0.146, 0.142),
                             loc=tuple(poll + hd * 0.15), m=B, seg=9, rings=5))
    parts.append(tube(name + "_face", poll + hd * 0.04, muzzle, 0.106, 0.063,
                        seg=7, m=B))
    parts.append(ellipsoid(name + "_muzzle", (0.082, 0.086, 0.074),
                             loc=tuple(muzzle + hd * 0.025), m=B, seg=9, rings=5))
    side = Vector((-hd.y, hd.x, 0.0))
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    for sgn in (-1, 1):
        parts.append(cyl(name + "_ear%d" % sgn, r=0.048, h=0.17, seg=5, r2=0.004,
                           loc=tuple(poll + side * (0.070 * sgn) + Vector((0, 0.03, 0.06))),
                           rot=(D2R(-14), D2R(13 * sgn), 0), m=B))
    parts.append(box(name + "_forelock", (0.09, 0.10, 0.13),
                       loc=tuple(poll + hd * 0.05 + Vector((0, 0, 0.06))), m=m_mane))
    # crest: on the neck's upper-rear normal, not straight up
    crest = Vector((0.0, nv.z, -nv.y)) if nv.y < 0 else Vector((0.0, -nv.z, nv.y))
    if crest.length > 1e-6:
        crest.normalize()
    for i in range(6):
        t = 0.06 + i * 0.175
        parts.append(box(name + "_mane%d" % i, (0.062, 0.20, 0.155),
                           loc=tuple(withers + nv * t + crest * 0.145),
                           rot=(math.atan2(-nv.y, nv.z), 0, 0), m=m_mane))
    parts.append(tube(name + "_dock", (0, 0.90, 1.44), (0, 1.02, 1.02),
                        0.088, 0.062, seg=6, m=B))
    parts.append(tube(name + "_tail", (0, 1.02, 1.04), (0, 1.10, 0.62),
                        0.082, 0.056, seg=6, m=m_mane))
    parts.append(ellipsoid(name + "_tuft", (0.070, 0.085, 0.115), loc=(0, 1.11, 0.60),
                             m=m_mane, seg=8, rings=4))

    if pose == "blown":
        pitch = {(-1, 0): 8, (1, 0): -6, (-1, 1): -9, (1, 1): 7}
    elif pose == "turn":
        pitch = {(-1, 0): -9, (1, 0): 6, (-1, 1): 5, (1, 1): -5}
    else:
        pitch = {(-1, 0): 4, (1, 0): -4, (-1, 1): -4, (1, 1): 4}
    for sx in (-1, 1):
        for fy, y0, top in ((0, -0.56, 1.08), (1, 0.74, 1.14)):
            pt = D2R(pitch[(sx, fy)])
            x = 0.246 * sx
            L1 = 0.50
            y1 = y0 + math.sin(pt) * L1
            z1 = top - math.cos(pt) * L1
            nm = "%s_l%d%d" % (name, sx, fy)
            parts.append(cyl(nm + "u", r=0.128, h=L1, seg=6, r2=0.086,
                               loc=(x, y0, top), rot=(math.pi - pt, 0, 0), m=B))
            parts.append(ellipsoid(nm + "k", (0.098, 0.102, 0.092), loc=(x, y1, z1),
                                     m=B, seg=7, rings=4))
            parts.append(cyl(nm + "l", r=0.076, h=z1 - 0.135, seg=6, r2=0.056,
                               loc=(x, y1, z1), rot=(math.pi, 0, 0), m=B))
            parts.append(ellipsoid(nm + "f", (0.068, 0.072, 0.062), loc=(x, y1, 0.142),
                                     m=B, seg=7, rings=4))
            parts.append(cyl(nm + "h", r=0.082, h=0.135, seg=6, r2=0.094,
                               loc=(x, y1, 0.004), m=m_hoof))

    o = joinall(parts, name)
    jitter(o, 0.005, seed)
    o.scale = (scale, scale, scale)
    o.rotation_euler = (0, 0, D2R(180.0 - az))
    o.location = (pos[0], pos[1], 0.0)
    return o

# ------------------------------------------------------------------ the rig

def aim_sun(light_obj, entry, target):
    """Aim a sun arithmetically instead of eyeballing it.

    d = normalize(target - entry); rx = acos(-d.z); rz = atan2(-d.x, d.y)
    """
    d = (Vector(target) - Vector(entry)).normalized()
    light_obj.rotation_euler = (math.acos(-d.z), 0.0, math.atan2(-d.x, d.y))
    return light_obj


def sun(name, entry, target, energy=4.0, color=(1.0, 0.95, 0.86), angle=1.6):
    d = bpy.data.lights.new(name, type='SUN')
    d.energy = energy
    d.color = color
    d.angle = D2R(angle)
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    return aim_sun(o, entry, target)


def area(name, loc, rot=(0, 0, 0), energy=50, size=2.0, color=(1, 1, 1), size_y=None):
    d = bpy.data.lights.new(name, type='AREA')
    d.energy = energy
    d.size = size
    if size_y:
        d.shape = 'RECTANGLE'
        d.size_y = size_y
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.collection.objects.link(o)
    return o


def sky(horizon, zenith, strength=1.0, ground=None, zenith_at=0.72):
    """A two- or three-stop vertical gradient world.

    Driven off the Z component of the incoming ray through a Map Range. A
    Gradient Texture behind a rotated Mapping node mixes the ray's axes and
    tints the zenith wrongly.

    Tint the fill and the sky, never the key's landing pool. Every card names
    its own two colours; there is no default.
    """
    w = bpy.data.worlds.get("CardSky") or bpy.data.worlds.new("CardSky")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    # Incoming points from the shading point back toward the camera, so a ray
    # travelling up has negative Incoming.z; map 1..-1, not -1..1.
    mr.inputs["From Min"].default_value = 1.0
    mr.inputs["From Max"].default_value = -1.0
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(geo.outputs["Incoming"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    # ColorRamp.elements re-sorts on insert, so a reference taken before new()
    # may point at a different stop. Create all stops first, then write them in
    # ascending order.
    cr = ramp.color_ramp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    low = ground if ground is not None else horizon
    # zenith_at is where the ramp reaches full zenith colour, as (1+sin(elev))/2.
    # 0.72 is 26 degrees up; much higher leaves low cloud lost in horizon pallor.
    stops = [(0.00, low), (0.46, low), (0.505, horizon), (zenith_at, zenith)]
    while len(cr.elements) < len(stops):
        cr.elements.new(0.99)
    for i, (pos, col) in enumerate(stops):
        el = cr.elements[i]
        el.position = pos
        el.color = (*col, 1)
    return w


def volume_box(name, size, loc, density=0.010, color=(1, 1, 1)):
    """Volume scatter in a box. Outward normals or it renders as nothing."""
    o = box(name, size, loc=loc)
    m = bpy.data.materials.new(name + "_vol")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vs = nt.nodes.new("ShaderNodeVolumeScatter")
    vs.inputs["Density"].default_value = density
    vs.inputs["Color"].default_value = (*color, 1)
    nt.links.new(vs.outputs[0], out.inputs["Volume"])
    o.data.materials.append(m)
    return o


def camera(loc, look_at, lens=40.0, name="Cam", clip_end=30000.0):
    """The card camera.

    clip_end matters: Blender's default far clip is 1000 m, and distant cloud
    sits at 2 to 3 km, so the default silently clips it.
    """
    d = bpy.data.cameras.new(name)
    d.lens = lens
    d.sensor_fit = 'HORIZONTAL'
    d.clip_end = clip_end
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    v = Vector(look_at) - Vector(loc)
    o.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o
    return o


def render_rig(out_path, pct=60, samples=140, exposure=0.0, contrast="AgX Base Contrast"):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        try:
            cp = prefs.preferences
            cp.compute_device_type = 'METAL'
            cp.get_devices()
            # Metal only, with MetalRT on. In a hybrid CPU+Metal render the
            # software BVH draws coincident coplanar faces black on the CPU
            # tiles only.
            if any(d.type == 'METAL' for d in cp.devices):
                for d in cp.devices:
                    d.use = (d.type == 'METAL')
            # metalrt lives on the addon preferences, not on scene.cycles.
            if hasattr(cp, "metalrt"):
                cp.metalrt = 'ON'
        except Exception:
            pass
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.volume_bounces = 1
    sc.render.resolution_x = 1000
    sc.render.resolution_y = 1400
    sc.render.resolution_percentage = pct
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_path
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = contrast
    except Exception:
        sc.view_settings.look = 'AgX - Base Contrast'
    sc.view_settings.exposure = exposure
    return sc


def render(out_path, pct=60, samples=140, exposure=0.0):
    render_rig(out_path, pct, samples, exposure)
    bpy.ops.render.render(write_still=True)
    return out_path


def wipe():
    """Clear every datablock. Never read_factory_settings in a live session.

    Removing `bpy.data.collections` also removes the view layer's active
    collection, leaving `bpy.context.collection` None, so the view layer is
    pointed back at the master collection afterwards (this matters mostly under
    `blender --background`).
    """
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.curves, bpy.data.node_groups,
                 bpy.data.collections, bpy.data.textures, bpy.data.armatures):
        for d in list(coll):
            try:
                coll.remove(d)
            except Exception:
                pass
    # Point the view layer back at the master collection, which is not in
    # bpy.data.collections and so survived the sweep.
    try:
        vl = bpy.context.view_layer
        vl.active_layer_collection = vl.layer_collection
    except Exception:
        pass
