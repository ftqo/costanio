"""Bake the resource hero props to RGBA PNGs, and export them as a .glb.

    blender --background --factory-startup \
        --python tools/blender/icons/render_icons.py -- OUTDIR [names...]

    HERO_OUTLINE=0.026 ...   one contour width instead of the default sweep
    HERO_GLB=path/to.glb ... also write the props out as a model

Contour width is a fraction of the frame, not a scene distance: an inverted
hull is a fixed world-space offset, so props framed at different scales would
get different line weights. The shipped SVGs stroke every icon at 4.5 units on
a 96 box, and a constant ratio keeps the set consistent. 0.026 of the frame is
the ~2.5 px a 5-unit centred stroke puts outside the path on a 96 box.

These props are icon art, not board art, so nothing here touches the blends
under `art/` or `palette.json`; the icons ship as flat files.

An offline bake rather than `renderShopThumbnails`, because it needs an
environment light and an inverted-hull contour, which the browser rig lacks.
See `frontend/src/lib/board3d/iconShots.ts`.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import props  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUTDIR = ARGS[0] if ARGS else os.path.join(HERE, "out")
WANT = ARGS[1:] or list(props.BUILDERS)
# Two contours and none. 0.11 world units against an ortho frame of ~2.2 is
# about 4.5% of the box (the SVGs' 4.5-unit stroke on 96); 0.055 is half that.
WIDTHS = [float(w) for w in os.environ.get("HERO_OUTLINE", "0.052,0.026,0").split(",")]
SIZES = (96, 384)

ELEV = 27.0
AZIM = 38.0
# Fraction of the frame the finished icon, contour included, spans on its
# longer axis, measured off the real silhouette. See `frame`.
FILL = 0.97


def clear():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


def final_mesh(ob, depsgraph):
    ev = ob.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=depsgraph)
    me.transform(ob.matrix_world)
    return me


def add_outline(objs, width):
    """One inverted hull over the whole prop, built from evaluated geometry.

    Built after modifiers so the brick's frogs and every bevel are in the
    contour. The hull is a separate object rather than a solidify on each
    part, so the prop gets one outline round its silhouette rather than one
    per component.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    merged = bpy.data.meshes.new("Res_outline")
    verts, faces = [], []
    for ob in objs:
        if ob.type != "MESH" or ob.hide_render:
            continue
        me = final_mesh(ob, depsgraph)
        base = len(verts)
        verts.extend([v.co.copy() for v in me.vertices])
        faces.extend([[base + i for i in p.vertices] for p in me.polygons])
        bpy.data.meshes.remove(me)
    merged.from_pydata(verts, [], faces)
    merged.update()

    # Weld first: parts arrive with split vertices at hard edges, and an
    # unwelded hull grows a fin at every corner. Merging gives each corner one
    # averaged normal, so the contour has a constant width.
    bm = bmesh.new()
    bm.from_mesh(merged)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * width
    bm.normal_update()
    bm.to_mesh(merged)
    bm.free()
    merged.update()

    hull = bpy.data.objects.new("Res_outline", merged)
    bpy.context.scene.collection.objects.link(hull)
    hull.data.materials.append(props.outline_material())
    hull.visible_shadow = False
    hull.visible_diffuse = False
    hull.visible_glossy = False
    return hull


def cam_axes(cam):
    q = cam.matrix_world.to_quaternion()
    return q @ Vector((1, 0, 0)), q @ Vector((0, 1, 0)), q @ Vector((0, 0, -1))


def projected_box(objs, cam):
    """The subject's true extent in the camera plane: (span, centre).

    Vertices of the evaluated meshes, not `ob.bound_box` (an axis-aligned box
    in the object's own space, which overstates a rotated prop).

    `span` is the longer of the two in-plane extents, because the frame is
    square and the icon has to fit either way round.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    right, up, _ = cam_axes(cam)
    lo = [1e30, 1e30]
    hi = [-1e30, -1e30]
    for ob in objs:
        if ob.type != "MESH" or ob.hide_render:
            continue
        me = final_mesh(ob, depsgraph)
        for v in me.vertices:
            for k, axis in enumerate((right, up)):
                d = v.co.dot(axis)
                lo[k] = min(lo[k], d)
                hi[k] = max(hi[k], d)
        bpy.data.meshes.remove(me)
    span = max(hi[0] - lo[0], hi[1] - lo[1])
    mid = [(lo[k] + hi[k]) / 2 for k in (0, 1)]
    return span, mid[0] * right + mid[1] * up


def aim(cam, span, centre):
    """Point the camera at `centre` and set the ortho scale that fits `span`."""
    _, _, fwd = cam_axes(cam)
    cam.data.ortho_scale = span / FILL
    cam.location = centre - fwd * 20.0


def silhouette_box(probe_res=192):
    """Render small and read back where the alpha actually is.

    The analytic extent is only approximate (curved outlines, bevels, and the
    hull's growth vary by surface), so this measures the rendered cell.

    Returns (span, cx, cy) as fractions of the frame, origin at the centre.
    """
    scene = bpy.context.scene
    rx, ry = scene.render.resolution_x, scene.render.resolution_y
    samples, path = scene.cycles.samples, scene.render.filepath
    probe = os.path.join(bpy.app.tempdir, "hero_probe.png")
    scene.render.resolution_x = scene.render.resolution_y = probe_res
    scene.cycles.samples = 4
    scene.render.filepath = probe
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x, scene.render.resolution_y = rx, ry
    scene.cycles.samples, scene.render.filepath = samples, path

    img = bpy.data.images.load(probe, check_existing=False)
    px = [0.0] * (len(img.pixels))
    img.pixels.foreach_get(px)
    n = probe_res
    lo = [n, n]
    hi = [-1, -1]
    for y in range(n):
        row = y * n
        for x in range(n):
            if px[(row + x) * 4 + 3] > 0.02:
                lo[0] = min(lo[0], x)
                hi[0] = max(hi[0], x)
                lo[1] = min(lo[1], y)
                hi[1] = max(hi[1], y)
    bpy.data.images.remove(img)
    if hi[0] < 0:
        return 0.0, 0.0, 0.0
    w = (hi[0] - lo[0] + 1) / n
    h = (hi[1] - lo[1] + 1) / n
    cx = ((lo[0] + hi[0] + 1) / 2) / n - 0.5
    cy = ((lo[1] + hi[1] + 1) / 2) / n - 0.5
    return max(w, h), cx, cy


def setup_world():
    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # A neutral dome rather than an HDRI: enough to keep every facet off zero,
    # with no image to ship and license.
    bg.inputs["Color"].default_value = (0.55, 0.58, 0.64, 1.0)
    bg.inputs["Strength"].default_value = 0.62


def setup_lights():
    key = bpy.data.lights.new("Key", "AREA")
    key.energy = 900
    key.size = 6.0
    ko = bpy.data.objects.new("Key", key)
    bpy.context.scene.collection.objects.link(ko)
    ko.location = (-5.0, -6.5, 8.0)
    ko.rotation_euler = (math.radians(38), 0, math.radians(-38))

    rim = bpy.data.lights.new("Rim", "AREA")
    rim.energy = 260
    rim.size = 8.0
    ro = bpy.data.objects.new("Rim", rim)
    bpy.context.scene.collection.objects.link(ro)
    ro.location = (6.0, 5.0, 4.0)
    ro.rotation_euler = (math.radians(66), 0, math.radians(140))


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 512
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filter_size = 1.3
    # Standard, not AgX: the design relies on albedo, which a filmic curve
    # compresses.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    setup_world()
    setup_lights()

    cam = bpy.data.cameras.new("Cam")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("Cam", cam)
    bpy.context.scene.collection.objects.link(co)
    co.rotation_euler = (math.radians(90 - ELEV), 0, math.radians(AZIM))
    scene.camera = co
    return co


def render_one(name, outdir, frac):
    """Bake one prop, framed so the finished icon fills FILL of the cell.

    `frac` is the contour width as a fraction of the frame, and the hull is
    part of the silhouette, so the frame and the hull depend on each other:
    guess analytically, build, measure the pixels, correct. Two probe renders
    land inside a pixel at 96.

    A fatter contour leaves less frame for the subject, as with a stroked
    vector, so the o0 bake is not a clean ablation of the contour.
    """
    clear()
    cam = setup_scene()
    coll = bpy.context.scene.collection
    objs = props.BUILDERS[name](coll)
    bpy.context.view_layer.update()
    meshes = [o for o in objs if o.type == "MESH"]

    # Analytic first guess. The hull pushes the silhouette out by about `width`
    # on every side, so the prop itself only gets (FILL - 2*frac) of the frame.
    span, centre = projected_box(meshes, cam)
    aim(cam, span / max(1e-3, 1.0 - 2 * frac / FILL), centre)

    hull = None
    for _ in range(2):
        if hull is not None:
            bpy.data.objects.remove(hull, do_unlink=True)
            hull = None
        if frac > 0:
            hull = add_outline(meshes, frac * cam.data.ortho_scale)
        bpy.context.view_layer.update()
        got, cx, cy = silhouette_box()
        if got <= 0:
            break
        # Recentre on the ink, then rescale; an off-centre icon clips on one
        # side.
        right, up, _ = cam_axes(cam)
        s = cam.data.ortho_scale
        cam.location = cam.location + (cx * s) * right + (cy * s) * up
        cam.data.ortho_scale = s * got / FILL

    if hull is not None:
        bpy.data.objects.remove(hull, do_unlink=True)
    width = frac * cam.data.ortho_scale
    if frac > 0:
        add_outline(meshes, width)
    bpy.context.view_layer.update()
    # `ortho` is how much world the cell covers, so `width` is the world-space
    # offset that looks the same on this prop (it differs per prop).
    print(f"FRAME {name} ortho={cam.data.ortho_scale:.4f} contour={width:.4f}")
    suffix = f"-o{frac:g}".replace(".", "")
    for size in SIZES:
        bpy.context.scene.render.resolution_x = size
        bpy.context.scene.render.resolution_y = size
        path = os.path.join(outdir, f"{name}{suffix}-{size}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("WROTE", path)


def export_glb(path):
    """All eight props in one file, for the browser-rig path.

    No outline hull: glTF cannot say "draw back faces only", so a baked hull
    would show as a navy shell unless the loader flipped the material's side
    (see iconShots.ts).
    """
    clear()
    setup_scene()
    coll = bpy.context.scene.collection
    for name in sorted(props.BUILDERS):
        for ob in props.BUILDERS[name](coll):
            if ob.hide_render:
                bpy.data.objects.remove(ob)
    bpy.context.view_layer.update()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print("WROTE", path)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    for name in WANT:
        for width in WIDTHS:
            render_one(name, OUTDIR, width)
    glb = os.environ.get("HERO_GLB")
    if glb:
        export_glb(glb)


main()
