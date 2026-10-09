"""Set a card's name onto its finished art.

    blender --background --python art/cards/tools/title.py -- in.png out.png "ALCHEMIST"

One ink colour for every card: a warm off-white reads on dark and bright art
alike, and the deck is shown by the HUD's pip and stripe, not the type.

Blender is the host because it can rasterise a font and write a PNG without
PIL. The scene is flat: an orthographic camera, the art on a plane, a scrim,
and the type, rendered through the Standard view transform so the ink lands at
exactly the value set here.
"""

import os
import sys

import bpy

W, H = 1000, 1400

# the one ink, and the scrim that guarantees it has something to sit on
INK = (0.945, 0.915, 0.845)
SCRIM = (0.035, 0.030, 0.028)
SCRIM_TOP = -0.02          # where the scrim starts fading in (ortho units)
SCRIM_MAX = 0.62           # how opaque it gets at the very bottom
BASELINE = -0.995          # title baseline
RULE_Y = -1.145
TRACKING = 1.10            # letter spacing multiplier
MAX_W = 1.70               # widest the title may run (frame is 2.0 across)
WEIGHT = 0.0016            # fattens the glyph outlines; Blender has no faux bold
OUTLINE = 0.0075           # how far the dark outline stands proud of the ink
OUTLINE_INK = (0.0, 0.0, 0.0)   # see TITLE.outline in frontend/src/lib/cardTitle.ts

# Bold single-face files rather than a synthesized bold.
#
# Gelasio Bold is vendored next to this file (SIL OFL) and is metrically
# compatible with Georgia Bold: 2048 units per em, 1419-unit cap height, and
# identical advance widths. The system paths are a last resort for a machine
# without the vendored font (Georgia cannot be redistributed).
#
# Known drift, left as is: Blender's `Curve.size` is not an em size. Blender
# normalises outlines by the font's bounding box (head.yMax - head.yMin), 3132
# units for Gelasio against Georgia's 2873, so at size 0.235 Gelasio sets 8.3%
# narrower and 9.6% shorter (ALCHEMIST: 555 px wide, 57 px cap, against 603 and
# 63). CSS sizes by the em and is unaffected. The fix would be size 0.2564, but
# these constants are the frozen spec the frontend is fitted to.
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = [
    os.path.join(HERE, "fonts", "Gelasio-Bold.ttf"),
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
                 bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


def emission(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes["Material Output"]
    for n in list(nt.nodes):
        if n != out:
            nt.nodes.remove(n)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
    return m


def plane(name, w, h, z, mat):
    v = [(-w/2, -h/2, z), (w/2, -h/2, z), (w/2, h/2, z), (-w/2, h/2, z)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], [(0, 1, 2, 3)])
    me.uv_layers.new()
    uv = me.uv_layers[0].data
    for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv[i].uv = c
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def art_material(path):
    img = bpy.data.images.load(path)
    m = bpy.data.materials.new("Art")
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes["Material Output"]
    for n in list(nt.nodes):
        if n != out:
            nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = 'Closest'      # 1:1 pixels, no resampling softness
    tex.location = (-400, 0)
    e = nt.nodes.new("ShaderNodeEmission")
    e.location = (-180, 0)
    nt.links.new(tex.outputs["Color"], e.inputs["Color"])
    nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
    return m, img


def scrim_material():
    """Black at the bottom of the frame, gone by SCRIM_TOP.

    Driven off the Generated coordinate's Y explicitly; a Gradient texture runs
    along X by default.
    """
    m = bpy.data.materials.new("Scrim")
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes["Material Output"]
    for n in list(nt.nodes):
        if n != out:
            nt.nodes.remove(n)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*SCRIM, 1)
    e.location = (-200, 120)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.location = (-200, -60)
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.location = (0, 0)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1000, -220)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-800, -220)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.location = (-580, -220)
    mr.inputs["From Min"].default_value = 0.0     # bottom of the plane
    mr.inputs["From Max"].default_value = 1.0     # top of the plane
    mr.inputs["To Min"].default_value = SCRIM_MAX
    mr.inputs["To Max"].default_value = 0.0
    mr.clamp = True
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Y"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(e.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def load_font():
    for p in FONTS:
        if os.path.exists(p):
            try:
                return bpy.data.fonts.load(p)
            except Exception:
                continue
    return None


def build(art_path, out_path, title):
    clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    # Standard, not AgX: the art is already graded, and the ink has to land on
    # exactly the value set above rather than be re-mapped by a film curve.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.use_nodes = False
    sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0

    amat, img = art_material(art_path)
    plane("Art", 2.0, 2.8, 0.0, amat)
    sh = SCRIM_TOP - (-1.4)
    sp = plane("Scrim", 2.0, sh, 0.05, scrim_material())
    sp.location.y = (SCRIM_TOP + (-1.4)) / 2

    f = load_font()

    def text(name, mat, weight, z):
        cur = bpy.data.curves.new(name, type='FONT')
        cur.body = title.upper()
        cur.align_x = 'CENTER'
        cur.align_y = 'BOTTOM_BASELINE'
        cur.space_character = TRACKING
        cur.offset = weight
        if f:
            cur.font = f
        cur.size = 0.235
        o = bpy.data.objects.new(name, cur)
        bpy.context.collection.objects.link(o)
        o.data.materials.append(mat)
        o.location = (0.0, BASELINE, z)
        return o, cur

    # the dark outline sits behind the ink and stands a little proud of it, so
    # the title holds on a bright meadow as well as on dark stone
    shadow, scur = text("Shadow", emission("Shadow", OUTLINE_INK, 1.0),
                        WEIGHT + OUTLINE, 0.08)
    ob, cur = text("Title", emission("Ink", INK, 1.0), WEIGHT, 0.10)

    # shrink until it fits the measured width, then stop
    for _ in range(40):
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        wdt = ob.evaluated_get(dg).dimensions.x
        if wdt <= MAX_W or cur.size < 0.075:
            break
        cur.size *= 0.94
        scur.size = cur.size

    # a hairline rule under the title, same ink, held back so it reads as a
    # rule and not as a second line of type
    rule = plane("Rule", 0.86, 0.006, 0.10, emission("Rule", INK, 0.55))
    rule.location.y = RULE_Y
    for s in (-1, 1):
        d = plane(f"Dot{s}", 0.020, 0.020, 0.10, emission(f"Dot{s}", INK, 0.55))
        d.location = (s * 0.46, RULE_Y, 0.10)

    cam = bpy.data.cameras.new("Cam")
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.0
    cam.sensor_fit = 'HORIZONTAL'
    co = bpy.data.objects.new("Cam", cam)
    co.location = (0, 0, 4)
    bpy.context.collection.objects.link(co)
    sc.camera = co

    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[title] {os.path.basename(art_path)} -> {out_path}  ({title})")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        raise SystemExit('usage: title.py -- <in.png> <out.png> "<TITLE>"')
    build(argv[0], argv[1], argv[2])


main()
