"""Purpose-built hero props for the resource icons.

Pure geometry + materials, no render settings, shared by the render prototype
and the blend edit script.

What survives a resample to thirteen pixels is albedo contrast, not shading
(a log stack reads because dark bark carries pale end discs). So every prop is
built around one high-contrast mark, and the eight silhouettes are chosen
against each other.
"""

import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# The vector icons' contour, #1c2b4a. Reused so a rendered icon and a drawn
# one sit in the same visual language if the set ever ends up mixed.
OUTLINE_HEX = "#1c2b4a"


def srgb(hexstr):
    """#rrggbb -> linear RGBA, which is what Blender wants in a node."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def mat(name, hexcol, rough=0.62, metal=0.0, spec=0.35):
    """A flat-ish Principled material. Never metalness 1.

    The shot rig has no environment map, so a fully metallic surface renders
    black. A coloured albedo on a dielectric needs no environment.
    """
    if name in bpy.data.materials:
        m = bpy.data.materials[name]
    else:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(hexcol)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    return m


def outline_material():
    """Inverted-hull ink.

    The hull is the prop's own mesh pushed out along its normals. Its near side
    would cover the prop, so the shader keeps only back faces: an unlit navy
    band exactly at the silhouette, like a vector icon's contour.
    """
    name = "Mat_Res_outline"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    mix = nt.nodes.new("ShaderNodeMixShader")
    emit = nt.nodes.new("ShaderNodeEmission")
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    emit.inputs["Color"].default_value = srgb(OUTLINE_HEX)
    # Keep only the hull's far side (Backfacing == 1); the near side would
    # paint the whole prop navy. The far side shows only where the hull
    # overhangs the silhouette: the outline.
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    m.use_backface_culling = True  # EEVEE takes this route instead
    return m


# ---------------------------------------------------------------- primitives


def new_mesh(name, collection=None):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def bm_to(ob, bm):
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def shade_smooth(ob, angle=math.radians(38)):
    """Smooth, with an edge split so hard corners stay hard.

    An EDGE_SPLIT modifier rather than the 5.x auto-smooth node group: the
    exporter's `apply_modifiers` can bake it, and it needs no bundled asset
    library.
    """
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("EdgeSplit", "EDGE_SPLIT")
    mod.split_angle = angle
    mod.use_edge_sharp = False


def assign(ob, *materials):
    ob.data.materials.clear()
    for m in materials:
        ob.data.materials.append(m)


def bevel(ob, width, segments=2):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(30)
    return m


# --------------------------------------------------------------------- props


def build_wood(coll):
    """Three cross-piled logs, ends to camera.

    High-contrast feature: the end grain. Bark is 0.055 linear and the sawn
    face 0.72, a thirteen-to-one albedo step.

    Silhouette: a squat triangle of three circles, the only pile in the set.
    """
    bark = mat("Mat_Res_wood_bark", "#3a2b21", rough=0.92, spec=0.2)
    grain = mat("Mat_Res_wood_grain", "#eddaad", rough=0.8, spec=0.25)
    ring = mat("Mat_Res_wood_ring", "#a06a3c", rough=0.85, spec=0.25)

    # Short and fat, so the sawn faces are a large fraction of the projected
    # area.
    R, L = 0.50, 1.28
    placements = [(-0.52, 0.0, -0.45), (0.52, 0.0, -0.45), (0.0, -0.12, 0.41)]
    objs = []
    for i, (x, y, z) in enumerate(placements):
        ob = new_mesh(f"Res_wood_log_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=24,
            radius1=R,
            radius2=R * 0.97,
            depth=L,
        )
        # Stand the cylinder on its side, axis along Y, so both sawn faces
        # point at the camera rather than at the sky.
        bmesh.ops.rotate(
            bm,
            verts=bm.verts,
            cent=(0, 0, 0),
            matrix=Matrix.Rotation(math.radians(90), 3, "X"),
        )
        # Bark relief: nudge every side vertex in and out radially, so it
        # does not read as pipe.
        for v in bm.verts:
            r = math.hypot(v.co.x, v.co.z)
            if r < R * 0.5:
                continue
            a = math.atan2(v.co.z, v.co.x)
            k = 1.0 + 0.045 * math.sin(a * 9 + i * 2.1) + 0.02 * math.sin(a * 21 + i)
            v.co.x *= k
            v.co.z *= k
        bm_to(ob, bm)

        # Slice the end caps into cambium ring / heartwood so the grain reads
        # as rings rather than as one flat disc.
        me = ob.data
        assign(ob, bark, grain, ring)
        for p in me.polygons:
            n = p.normal
            if abs(n.y) > 0.8:
                p.material_index = 1
        _inset_cap(ob, ring_index=2)
        shade_smooth(ob)
        ob.location = (x, y, z)
        ob.rotation_euler = Euler((0, math.radians(2.5 * (i - 1)), 0))
        objs.append(ob)
    return objs


def _inset_cap(ob, ring_index):
    """Turn each sawn face into cambium ring / sapwood / heart.

    Three concentric bands: the outer band is the dark cambium and everything
    inside it is pale.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    caps = [f for f in bm.faces if abs(f.normal.y) > 0.8]
    if not caps:
        bm_to(ob, bm)
        return
    # 1. Cambium: a thin dark band just inside the bark.
    rim = bmesh.ops.inset_individual(bm, faces=caps, thickness=0.045, depth=-0.010)
    for f in rim["faces"]:
        f.material_index = ring_index
    for f in caps:
        f.material_index = 1
    # 2. A single growth ring inside the pale face, one shade down. Two marks
    # is enough to read as rings; more disappears at 26px anyway.
    inner = bmesh.ops.inset_individual(bm, faces=caps, thickness=0.16, depth=-0.006)
    for f in inner["faces"]:
        f.material_index = ring_index
    for f in caps:
        f.material_index = 1
    bm_to(ob, bm)


def build_brick(coll):
    """One brick, three-quarter, three frogs sunk into its bed face.

    High-contrast feature: the frogs, three near-black rectangles in a mid-red
    top face (dark on light, the reverse of the wood).

    Silhouette: the only hard-cornered convex block in the set.
    """
    body = mat("Mat_Res_brick_body", "#b2482f", rough=0.85, spec=0.2)
    bed = mat("Mat_Res_brick_bed", "#cd6142", rough=0.85, spec=0.2)
    frog = mat("Mat_Res_brick_frog", "#40160f", rough=0.9, spec=0.15)

    W, D, H = 1.9, 0.92, 0.66
    ob = new_mesh("Res_brick_body", coll)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= W
        v.co.y *= D
        v.co.z *= H
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bm_to(ob, bm)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.material_index = 0
        if f.normal.z > 0.9:
            f.material_index = 1
    bm_to(ob, bm)
    assign(ob, body, bed, frog)

    # Three frogs, cut as separate sunk boxes rather than by insetting the top
    # face, which would need a grid the box does not have.
    holes = []
    for i, cx in enumerate((-0.58, 0.0, 0.58)):
        h = new_mesh(f"Res_brick_frog_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= 0.42
            v.co.y *= 0.44
            v.co.z *= 0.30
        bm_to(h, bm)
        assign(h, frog)
        h.location = (cx, 0.0, H / 2 - 0.13)
        holes.append(h)

    # The frog is a recess, so subtract it and re-tag the new walls dark.
    for h in holes:
        m = ob.modifiers.new(f"Frog_{h.name}", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = h
        m.solver = "EXACT"
        m.material_mode = "TRANSFER"
        h.hide_render = True
        h.hide_viewport = True

    bevel(ob, 0.035, segments=2)
    return [ob] + holes


def build_ore(coll):
    """A broken rock with a cluster of crystals growing out of the fracture.

    High-contrast feature: the crystals. Pale ice-blue prisms (0.62 linear)
    against a blue-grey rock (0.10), in a cold hue no other prop uses.

    Silhouette: the only spiked outline in the set.
    """
    rock = mat("Mat_Res_ore_rock", "#374b66", rough=0.9, spec=0.25)
    crystal = mat("Mat_Res_ore_crystal", "#c9ecf6", rough=0.22, spec=0.6)

    ob = new_mesh("Res_ore_rock", coll)
    bm = bmesh.new()
    # One subdivision: fewer, bigger facets, which do not average to a smooth
    # egg at 26 px.
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.78)
    for i, v in enumerate(bm.verts):
        h = math.sin(i * 12.9898) * 43758.5453
        k = 0.72 + 0.46 * (h - math.floor(h))
        v.co *= k
        v.co.z *= 0.66
    bm_to(ob, bm)
    assign(ob, rock, crystal)

    shards = []
    # Long enough to break the rock's outline.
    spec = [
        (-0.16, -0.04, 0.24, 16, -11, 0.24, 1.30),
        (0.26, 0.08, 0.20, -13, 21, 0.20, 1.02),
        (0.04, -0.26, 0.22, 5, 4, 0.17, 0.80),
        (-0.48, 0.16, 0.12, 32, -29, 0.15, 0.66),
    ]
    for i, (x, y, z, rx, ry, r, hgt) in enumerate(spec):
        s = new_mesh(f"Res_ore_crystal_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=6, radius1=r, radius2=r * 0.82, depth=hgt
        )
        for v in bm.verts:
            if v.co.z > 0:
                v.co.z += 0.0
        # Point the tip.
        top = [v for v in bm.verts if v.co.z > hgt / 2 - 1e-4]
        cx = sum((v.co.x for v in top), 0.0) / len(top)
        cy = sum((v.co.y for v in top), 0.0) / len(top)
        for v in top:
            v.co.x = cx + (v.co.x - cx) * 0.28
            v.co.y = cy + (v.co.y - cy) * 0.28
            v.co.z += hgt * 0.38
        bm_to(s, bm)
        assign(s, crystal)
        s.location = (x, y, z)
        s.rotation_euler = Euler((math.radians(rx), math.radians(ry), math.radians(i * 27)))
        shards.append(s)
    return [ob] + shards


def build_coin(coll):
    """A stack of struck coins with one face-up disc leaning against it.

    High-contrast feature: the dark separations between coins (bright rims,
    near-black gaps).

    Silhouette: the only stack of horizontal bands, plus a leaning disc
    low-left.

    Metalness 0; see `mat`.
    """
    # Silver, to suit the blue coin card. A light silver separates on value
    # from ore's mid-tone grey (17.1 dE on the dark panel; darker silvers
    # measured 13.7 and 11.8). Contrast: 3.05:1 in the ResCard well, 4.43:1 on
    # the dark panel. Re-run `tools/icons/measure.py` if you change these.
    gold = mat("Mat_Res_coin_gold", "#c2c8d0", rough=0.34, spec=0.55)
    rim = mat("Mat_Res_coin_rim", "#8b939d", rough=0.42, spec=0.5)
    gap = mat("Mat_Res_coin_gap", "#3a4048", rough=0.8, spec=0.2)

    objs = []
    R, T = 0.62, 0.19
    for i in range(4):
        c = new_mesh(f"Res_coin_disc_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=32, radius1=R, radius2=R, depth=T
        )
        bm_to(c, bm)
        assign(c, gold, rim, gap)
        for p in c.data.polygons:
            if abs(p.normal.z) < 0.5:
                p.material_index = 1
        bevel(c, 0.035, segments=2)
        c.location = (0.10 * math.sin(i * 1.7), 0.05 * math.cos(i * 2.3), -0.62 + i * (T + 0.045))
        c.rotation_euler = Euler((0, 0, math.radians(i * 17)))
        objs.append(c)
        # The dark sliver between two coins: a slightly smaller dark disc in
        # the gap, standing in for ambient occlusion.
        if i:
            g = new_mesh(f"Res_coin_gap_{i}", coll)
            bm = bmesh.new()
            bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=False,
                segments=32,
                radius1=R * 0.995,
                radius2=R * 0.995,
                depth=0.045,
            )
            bm_to(g, bm)
            assign(g, gap)
            g.location = (
                objs[-1].location.x,
                objs[-1].location.y,
                -0.62 + i * (T + 0.045) - T / 2 - 0.022,
            )
            objs.append(g)

    face = new_mesh("Res_coin_face", coll)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=32, radius1=R * 1.02, radius2=R * 1.02, depth=T
    )
    caps = [f for f in bm.faces if f.normal.z > 0.5]
    bmesh.ops.inset_individual(bm, faces=caps, thickness=0.09, depth=0.02)
    bm_to(face, bm)
    assign(face, gold, rim)
    for p in face.data.polygons:
        if abs(p.normal.z) < 0.5:
            p.material_index = 1
    bevel(face, 0.03, segments=2)
    face.rotation_euler = Euler((math.radians(74), 0, math.radians(-18)))
    face.location = (-0.72, -0.55, -0.34)
    objs.append(face)
    return objs


def build_wheat(coll):
    """A bound sheaf standing on its cut ends.

    High-contrast feature: the twine, a dark band across the waist of a bright
    gold body, plus the serrated crown of ears.

    Silhouette: the only tall vertical in the set, pinched in the middle.
    """
    stalk = mat("Mat_Res_wheat_stalk", "#d8a63a", rough=0.8, spec=0.25)
    ear = mat("Mat_Res_wheat_ear", "#f2cf68", rough=0.75, spec=0.3)
    twine = mat("Mat_Res_wheat_twine", "#4a3116", rough=0.9, spec=0.2)

    objs = []
    # The bundle is one solid of revolution with grooves, not separate stalks:
    # the inverted hull would show navy through every gap between stalks.
    #
    # The crown flares 2.7x the waist; less reads as a rounded rectangle at
    # 13 px.
    profile = [
        (-0.86, 0.30),  # cut ends, splayed where the sheaf takes its weight
        (-0.55, 0.26),
        (-0.15, 0.215),  # the waist, where the twine bites
        (0.10, 0.27),
        (0.35, 0.40),
        (0.60, 0.52),
        (0.82, 0.56),  # the crown, fanned
        (0.98, 0.42),
    ]
    # `seg` (ring resolution) and `LOBES` (stalks) must not be locked together:
    # `sin(a * seg/2)` sampled at `a = i/seg * tau` is zero at every vertex.
    # Sample several times per lobe.
    seg = 60
    LOBES = 13
    body = new_mesh("Res_wheat_bundle", coll)
    bm = bmesh.new()
    rings = []
    for pi, (z, r) in enumerate(profile):
        crown = pi >= len(profile) - 2
        ring = []
        for i in range(seg):
            a = i / seg * math.tau
            # Grooves: a flute per stalk. Deeper towards the crown (0.20, a
            # serration on the outline), never below 0.09 at the cut ends.
            depth = 0.09 + 0.21 * max(0.0, (z + 0.15) / 1.13)
            lobe = math.sin(a * LOBES)
            rr = r * (1.0 + depth * lobe)
            # Saw the top edge: push each lobe's top up and each groove's top
            # down, so the silhouette's upper edge is serrated rather than a
            # clean arc.
            zz = z + (0.20 * (0.5 + 0.5 * lobe) * (1.0 if pi == len(profile) - 1 else 0.45)
                      if crown else 0.0)
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, zz)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    for ring, cz in ((rings[0], -0.88), (rings[-1], 0.92)):
        hub = bm.verts.new((0, 0, cz))
        for i in range(seg):
            j = (i + 1) % seg
            tri = (ring[i], ring[j], hub) if cz > 0 else (ring[j], ring[i], hub)
            bm.faces.new(tri)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(body, bm)
    assign(body, stalk)
    shade_smooth(body, math.radians(24))
    objs.append(body)

    # The crown: ears leaning out over the rim of the fan, touching the body so
    # the hull does not outline each separately.
    for i in range(13):
        a = i / 13 * math.tau + 0.35
        inner = i % 3 == 1
        rad = 0.0 if i == 12 else (0.24 if inner else 0.44)
        e = new_mesh(f"Res_wheat_ear_{i}", coll)
        bm = bmesh.new()
        # Short: they only break the dome's rim. The body carries the fan;
        # long ears read as spikes.
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.0, radius2=0.10, depth=0.54
        )
        for v in bm.verts:
            v.co.z = -v.co.z
            if math.hypot(v.co.x, v.co.y) > 1e-5:
                k = 1.0 + 0.42 * math.sin(v.co.z * 34)
                v.co.x *= k
                v.co.y *= k
        bm_to(e, bm)
        assign(e, ear)
        e.location = (
            math.cos(a) * rad,
            math.sin(a) * rad,
            0.92 + (0.10 if i == 12 else 0.0) + (0.06 if inner else 0.0),
        )
        lean = math.radians(16 if inner else 40)
        e.rotation_euler = Euler((lean * math.sin(a), -lean * math.cos(a), 0))
        objs.append(e)

    # Twine, wound three times so it reads as tied rather than painted.
    for k in range(3):
        band = new_mesh(f"Res_wheat_twine_{k}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=False,
            cap_tris=False,
            segments=26,
            radius1=0.235,
            radius2=0.235,
            depth=0.085,
        )
        bm_to(band, bm)
        assign(band, twine)
        shade_smooth(band)
        band.location = (0, 0, -0.20 + k * 0.10)
        band.rotation_euler = Euler((math.radians(4), 0, 0))
        objs.append(band)
    return objs


def build_sheep(coll):
    """One standing animal, side on, dark head and legs under a pale fleece.

    High-contrast feature: the face and legs. Fleece is 0.80 linear against a
    0.02 head, and the legs punch holes through the silhouette.

    Silhouette: a scalloped cloud on legs. The scallops are geometry, so they
    survive at 13px.
    """
    fleece = mat("Mat_Res_sheep_fleece", "#f3efe6", rough=0.88, spec=0.2)
    dark = mat("Mat_Res_sheep_dark", "#232838", rough=0.7, spec=0.3)

    objs = []
    body = new_mesh("Res_sheep_body", coll)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.80)
    for v in bm.verts:
        v.co.x *= 1.18
        v.co.y *= 0.80
        # Lumps: a low-frequency bump field over the sphere, big enough to be
        # a bite out of the outline rather than a highlight.
        n = v.co.normalized()
        k = 1.0 + 0.150 * math.sin(n.x * 6.4) * math.sin(n.z * 5.6) + 0.10 * math.sin(n.y * 4.8 + 1.1)
        v.co *= k
    bm_to(body, bm)
    assign(body, fleece)
    shade_smooth(body, math.radians(50))
    body.location = (0, 0, 0.24)
    objs.append(body)

    head = new_mesh("Res_sheep_head", coll)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=12, radius=0.30)
    for v in bm.verts:
        v.co.x *= 1.25
        v.co.z *= 0.86
    bm_to(head, bm)
    assign(head, dark)
    shade_smooth(head)
    head.location = (-1.02, -0.10, 0.34)
    head.rotation_euler = Euler((0, math.radians(-14), 0))
    objs.append(head)

    for i, (ex, ez) in enumerate(((-0.16, 0.30), (-0.10, 0.14))):
        ear = new_mesh(f"Res_sheep_ear_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.15)
        for v in bm.verts:
            v.co.x *= 1.5
            v.co.z *= 0.4
        bm_to(ear, bm)
        assign(ear, dark)
        shade_smooth(ear)
        ear.location = (-0.92 + ex, 0.22 if i else -0.34, 0.52 + ez * 0.2)
        ear.rotation_euler = Euler((0, math.radians(-25), math.radians(30 if i else -30)))
        objs.append(ear)

    for i, (lx, ly) in enumerate(((-0.55, -0.34), (-0.55, 0.30), (0.62, -0.34), (0.62, 0.30))):
        leg = new_mesh(f"Res_sheep_leg_{i}", coll)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=10, radius1=0.115, radius2=0.085, depth=0.72
        )
        bm_to(leg, bm)
        assign(leg, dark)
        shade_smooth(leg)
        leg.location = (lx, ly, -0.50)
        objs.append(leg)
    return objs


def build_cloth(coll):
    """A ball of wound yarn, with a loose end trailing off it.

    A sphere risks reading as a circle like the coin at 13 px (the cost chips
    draw on a bare panel), so the circle is broken in silhouette:

      - the ball is oblate, 0.84 in z;
      - a loose thread leaves the top right, loops clear of the body and hangs
        past the bottom, adding a bump and a tail outside the outline;
      - the ball sits slightly left of the thread's arc, so the prop is
        asymmetric.

    High-contrast feature: the windings, real grooves with dark yarn in the
    trough against lit yarn on the ridge. They read at 26 px; at 13 px the
    shape carries it.
    """
    yarn = mat("Mat_Res_cloth_yarn", "#2f56ad", rough=0.94, spec=0.16)
    trough = mat("Mat_Res_cloth_trough", "#16295c", rough=0.95, spec=0.12)

    R, FLAT = 1.0, 0.84
    # Turns per hemisphere. 26 puts a thread at about a pixel and a half at
    # 26 px, the finest that survives; fewer read as broad bands.
    WIND = 23.0

    def wind(x, y, z):
        """Depth of the winding groove at a point on the unit sphere, 0..1.

        One family of turns: two crossed families chop each other into
        dashes. The hand-wound wobble comes from bending the winding axis, so
        the turns stay unbroken.
        """
        a = math.atan2(y, x)
        u = math.asin(max(-1.0, min(1.0, 0.93 * z + 0.34 * x))) + 0.07 * math.sin(3.0 * a)
        return 0.5 - 0.5 * math.cos(WIND * u)

    ball = new_mesh("Res_cloth_ball", coll)
    bm = bmesh.new()
    # Dense: a 26-turn groove needs several vertices across each thread or the
    # displacement aliases into a coarser pattern than the one asked for.
    bmesh.ops.create_uvsphere(bm, u_segments=176, v_segments=104, radius=R)
    for v in bm.verts:
        n = v.co.normalized()
        # Cut the grooves in, and squash after, so the grooves are even.
        v.co = n * (R * (1.0 - 0.030 * wind(n.x, n.y, n.z)))
        v.co.z *= FLAT
    bm_to(ball, bm)
    assign(ball, yarn, trough)
    # Paint the troughs by depth (radius) rather than by normal, since a
    # groove's two flanks face opposite ways.
    mid = R * (1.0 - 0.030 * 0.45)
    for poly in ball.data.polygons:
        c = poly.center.copy()
        c.z /= FLAT
        if c.length < mid:
            poly.material_index = 1
    shade_smooth(ball, math.radians(62))
    ball.location = (-0.10, 0.0, 0.0)

    # The loose end. Thick (0.075 against a ball of 1.0) so it survives at
    # 13 px.
    THREAD_R = 0.075
    path = []
    for i in range(29):
        t = i / 28
        # Spiralling outward and stopping; a closed loop reads as a handle.
        ang = math.radians(58) - t * math.radians(206)
        rad = 1.02 + 0.40 * t**1.7
        path.append(
            Vector(
                (
                    math.cos(ang) * rad * 1.02 - 0.10,
                    -0.34 - 0.16 * math.sin(t * math.pi),
                    math.sin(ang) * rad * FLAT - 0.22 * t * t,
                )
            )
        )

    thread = new_mesh("Res_cloth_thread", coll)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(path):
        fwd = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = fwd.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = fwd.cross(Vector((0, 0, 1)))
        side.normalize()
        upv = side.cross(fwd).normalized()
        taper = 1.0 if i < len(path) - 4 else 0.55
        ring = []
        for k in range(7):
            a = k / 7 * math.tau
            off = side * (math.cos(a) * THREAD_R * taper) + upv * (math.sin(a) * THREAD_R * taper)
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(7):
            j = (k + 1) % 7
            bm.faces.new((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
    for ring, flip in ((rings[0], False), (rings[-1], True)):
        hub = bm.verts.new(sum(( v.co for v in ring), Vector()) / 7)
        for k in range(7):
            j = (k + 1) % 7
            tri = (ring[j], ring[k], hub) if flip else (ring[k], ring[j], hub)
            bm.faces.new(tri)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(thread, bm)
    assign(thread, yarn)
    shade_smooth(thread, math.radians(50))
    return [ball, thread]


def build_paper(coll):
    """A stack of hand-made sheets, deckle-edged, seen three-quarter on.

    The shape must be stiff: a rectangle sampled along its edges with exact
    corner vertices, a deckle that is only a local nick dying before each
    corner, seven sheets, and a real recessed gap between them (as with the
    coins). Rounded corners or a wavy outline read as a sack.

    Separation from the brick (both are hard-cornered blocks) comes from
    proportion and stagger: the pile stands 0.54 of its width tall against
    the brick's 0.35, with notched sides, and no frogs. It stays warm
    off-white and ragged to differ from the development-card deck.

    High-contrast feature: the gaps between sheets. Edge walls are pale and
    each gap is a recessed band the contour inks navy, so the side reads as
    six dark rules on a light body.

    Built as one solid with grooves rather than seven sheets, so the inverted
    hull does not show through the gaps.
    """
    # Aged tan, so the paper does not sit near the near-white fleece in colour.
    # Three grades: the lit top sheet, the edge walls a step under it, and the
    # gaps well under that.
    sheet = mat("Mat_Res_paper_sheet", "#cfb682", rough=0.93, spec=0.16)
    edge = mat("Mat_Res_paper_edge", "#a3874f", rough=0.94, spec=0.14)
    seam = mat("Mat_Res_paper_seam", "#42341a", rough=0.95, spec=0.10)

    # Seven sheets with a real stagger: more average to fur at small sizes,
    # and fewer aligned sheets read as the brick.
    LAYERS = 7
    HX, HY = 1.00, 0.76
    THICK = 0.190  # one sheet plus the gap above it
    BODY = 0.80  # of THICK: the sheet itself. The rest is the gap.
    # How far the gap is recessed behind the sheet edge, smaller than the
    # contour offset (0.07 world at this framing), so the hull inks the gaps
    # navy. This sets the line's width; too wide and the lower half averages
    # to grey at 13 px.
    INSET = 0.034
    # Segments per edge, long/short/long/short. Sampled by arc length rather
    # than angle, so points are not crowded at the corners.
    SEG = (30, 22, 30, 22)
    N = sum(SEG)
    CORNERS = ((HX, HY), (-HX, HY), (-HX, -HY), (HX, -HY))  # ccw
    # Deckle amplitude, as a world distance: 1.5% of the width, texture on a
    # straight edge rather than a change to the silhouette.
    DECKLE = 0.030
    # No nick within this far of a corner, so corners stay sharp.
    CORNER_HOLD = 0.17
    # No curled corner: the top sheet must stay one flat lit plane against the
    # shadowed edge below. Asymmetry comes from rotating the top sheet off the
    # pile so a corner overhangs.

    def edge_normal(e):
        (x0, y0), (x1, y1) = CORNERS[e], CORNERS[(e + 1) % 4]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        return dy / L, -dx / L, L  # outward for a ccw ring

    def outline(layer):
        """One sheet's edge as [(x, y, nx, ny)], corners exact.

        `n` is the outward normal at that point, kept so the recessed gap can
        be cut by stepping every point straight back into the sheet.
        """
        pts = []
        for e in range(4):
            x0, y0 = CORNERS[e]
            x1, y1 = CORNERS[(e + 1) % 4]
            nx, ny, L = edge_normal(e)
            px, py, _ = edge_normal((e - 1) % 4)
            for i in range(SEG[e]):
                t = i / SEG[e]
                d = L * t
                if i == 0:
                    # The corner vertex itself: zero deckle, normal along the
                    # bisector.
                    bx, by = nx + px, ny + py
                    m = math.hypot(bx, by) or 1.0
                    pts.append((x0, y0, bx / m * math.sqrt(2.0), by / m * math.sqrt(2.0)))
                    continue
                # Two high frequencies in world units (the same grain on every
                # edge), squared through `w*|w|` so the edge is mostly straight
                # with occasional nicks.
                ph = layer * 2.399 + e * 1.7
                w = 0.62 * math.sin(d * 19.0 + ph) + 0.38 * math.sin(d * 41.0 - ph * 1.4)
                damp = min(1.0, d / CORNER_HOLD) * min(1.0, (L - d) / CORNER_HOLD)
                k = DECKLE * w * abs(w) * damp
                pts.append((x0 + (x1 - x0) * t + nx * k, y0 + (y1 - y0) * t + ny * k, nx, ny))
        return pts

    def placed(layer):
        """`outline`, put where its sheet sits in the pile.

        Offsets and rotations, jittered rather than drifting (a drift reads as
        a fan of cards), so the side reads as separate sheets. The top sheet
        gets several times the rotation so one corner overhangs. The values are
        the smallest that tell the stack from the brick at 13 px.
        """
        top = layer == LAYERS - 1
        rot = math.radians(11.0) if top else math.radians(4.4) * math.sin(layer * 2.3)
        ox = 0.075 * math.sin(layer * 3.1) + (0.05 if top else 0.0)
        oy = 0.065 * math.cos(layer * 1.9)
        ca, sa = math.cos(rot), math.sin(rot)
        return [
            (
                x * ca - y * sa + ox,
                x * sa + y * ca + oy,
                nx * ca - ny * sa,
                nx * sa + ny * ca,
            )
            for x, y, nx, ny in outline(layer)
        ]

    ob = new_mesh("Res_paper_stack", coll)
    bm = bmesh.new()

    def ring(pts, z, inset=0.0):
        return [bm.verts.new((x - nx * inset, y - ny * inset, z)) for x, y, nx, ny in pts]

    def band(lo, hi, index):
        for i in range(N):
            j = (i + 1) % N
            f = bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
            f.material_index = index

    sheets = [placed(layer) for layer in range(LAYERS)]
    # Every sheet's own bottom ring, built once so the gap below and the wall
    # above share vertices.
    lows = [ring(pts, layer * THICK) for layer, pts in enumerate(sheets)]
    last = None
    for layer, pts in enumerate(sheets):
        z0 = layer * THICK
        high = ring(pts, z0 + THICK * BODY)
        band(lows[layer], high, 1)  # the sheet's own edge wall
        if layer == LAYERS - 1:
            last = high
            break
        # The gap: step back into the sheet, cross the void, step back out
        # under the sheet above. Three seam bands (ledge, recessed wall,
        # underside of the next sheet), modelled because a downsample keeps
        # albedo but not contact shadow.
        inner_lo = ring(pts, z0 + THICK * BODY, INSET)
        inner_hi = ring(sheets[layer + 1], z0 + THICK, INSET)
        band(high, inner_lo, 2)
        band(inner_lo, inner_hi, 2)
        band(inner_hi, lows[layer + 1], 2)

    def cap(pts, verts, z, up, index):
        hub = bm.verts.new(
            (
                sum(p[0] for p in pts) / N,
                sum(p[1] for p in pts) / N,
                z,
            )
        )
        for i in range(N):
            j = (i + 1) % N
            f = bm.faces.new((verts[i], verts[j], hub) if up else (verts[j], verts[i], hub))
            f.material_index = index

    cap(sheets[0], lows[0], 0.0, False, 1)
    cap(sheets[-1], last, (LAYERS - 1) * THICK + THICK * BODY, True, 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(ob, bm)
    assign(ob, sheet, edge, seam)
    # 25 degrees, so the corner between a sheet's wall and the gap stays hard
    # while the shallower deckle nicks stay smooth.
    shade_smooth(ob, math.radians(25))
    # Leaning, so the edge shows. Mostly z-rotation, which keeps the stack off
    # parallel with the brick; little tilt, so the top stays one plane.
    ob.rotation_euler = Euler((math.radians(-4), math.radians(3), math.radians(-17)))
    ob.location = (0, 0, -0.52)
    return [ob]


BUILDERS = {
    "wood": build_wood,
    "brick": build_brick,
    "sheep": build_sheep,
    "wheat": build_wheat,
    "ore": build_ore,
    "cloth": build_cloth,
    "paper": build_paper,
    "coin": build_coin,
}
