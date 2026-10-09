"""The lattice rule for ground features, tested without launching Blender.

`make check-hexes` proves every shipped tile's ponds, pools, creeks and bars
are the ground's own triangles. This proves the rule can still tell them from
the things it was written against: a polygon laid over the ground, and a
level sheet the sloping terrain cuts along a contour.
"""

import math
import unittest

import featurelattice as fl
import hexcontract as hc
from test_hexcontract import land


def ground(z_of=lambda x, y: 0.3):
    verts, tris, keys = fl.lattice_ground(z_of)
    return verts, tris, keys


def pond(verts, tris, cx=-0.8, cy=-0.8, r=0.55, **kw):
    region = fl.region_from_polygons(verts, tris, lambda x, y: math.hypot(x - cx, y - cy) < r)
    return fl.tidy_region(tris, region), kw


def sheet_tris(pos, faces):
    return [tuple(pos[i] for i in f) for f in faces]


def ground_tris(verts, tris):
    return [tuple(tuple(verts[i]) for i in t) for t in tris]


def octagon(cx, cy, r, z, turn=0.13):
    ring = [
        (cx + r * math.cos(turn + k * math.pi / 4), cy + r * math.sin(turn + k * math.pi / 4), z)
        for k in range(8)
    ]
    centre = (cx, cy, z)
    return [(centre, ring[k], ring[(k + 1) % 8]) for k in range(8)]


class TestSharedLattice(unittest.TestCase):
    def test_point_and_triangle_counts(self):
        pts = fl.shared_lattice()
        self.assertEqual(len(pts), 631)
        self.assertEqual(len(fl.shared_lattice_triangles(pts)), 1176)

    def test_ring_14_on_rim_inner_edge(self):
        pts = fl.shared_lattice()
        outer = [p for k, p in pts.items() if fl.lattice_ring(k) == 14]
        for x, y in outer:
            self.assertAlmostEqual(hc.apothem(x, y), fl.LATTICE_OUTER_APOTHEM, places=3)

    def test_inner_edges_on_lattice_directions(self):
        # Ring 14 is pulled in onto the rim, so the band between it and ring
        # 13 is the one place the lattice bends; nothing is cut there.
        verts, tris, keys = ground()
        inner = [t for t in tris if all(fl.lattice_ring(keys[v]) < 14 for v in t)]
        segs = [(verts[t[a]], verts[t[b]]) for t in inner for a, b in ((0, 1), (1, 2), (2, 0))]
        self.assertGreater(len(segs), 3000)
        self.assertTrue(all(fl.on_direction(a, b) for a, b in segs))


class TestCarvedBasin(unittest.TestCase):
    def setUp(self):
        # A slope, so a level sheet laid on it would be cut by it.
        self.verts, self.tris, _ = ground(lambda x, y: 0.30 + 0.05 * x)
        self.region, _ = pond(self.verts, self.tris)
        self.cut = fl.carve_basin(self.verts, self.tris, self.region)
        pos, faces, self.tones, self.lips = fl.water_sheet(
            self.verts, self.tris, self.region, self.cut["level"], self.cut["depth"]
        )
        self.water = sheet_tris(pos, faces)

    def test_outline_on_lattice(self):
        on_dir, on_vert, length = fl.alignment(self.water, [v[:2] for v in self.verts])
        self.assertGreater(length, 1.0)
        self.assertEqual((on_dir, on_vert), (1.0, 1.0))

    def test_ground_never_pokes_through(self):
        n, _ = fl.ground_through(self.water, ground_tris(self.verts, self.tris))
        self.assertEqual(n, 0)

    def test_bank_above_water(self):
        ring = fl.shore_ring(self.tris, self.region, self.cut["edge"])
        self.assertTrue(ring)
        for v in ring:
            self.assertGreater(self.verts[v][2], self.cut["level"])

    def test_three_tones(self):
        self.assertEqual(set(self.tones), {0, 1, 2})

    def test_lips_do_not_move_outline(self):
        # The lips are vertical: adding them must not move the outline.
        quads = [(q[0], q[1], q[2]) for q in self.lips] + [(q[0], q[2], q[3]) for q in self.lips]
        on_dir, on_vert, _ = fl.alignment(fl.surfaces(self.water + quads), [v[:2] for v in self.verts])
        self.assertEqual((on_dir, on_vert), (1.0, 1.0))

    def test_rule_passes(self):
        parts = [("Pasture_pond", [(t, "Mat_Pasture_water") for t in self.water])]
        self.assertEqual(fl.violations("Pasture", parts, [v[:2] for v in self.verts]), [])

    def test_outline_is_one_loop(self):
        loop = fl.region_outline(self.verts, self.tris, self.region)
        self.assertEqual(len(loop), len(self.cut["edge"]))


class TestRuleFails(unittest.TestCase):
    def setUp(self):
        self.verts, self.tris, _ = ground(lambda x, y: 0.30 + 0.05 * x)
        self.points = [v[:2] for v in self.verts]

    def test_polygon_on_top(self):
        # The pasture's octagon pond, the oasis's 18-gon, the lake's 26-gon.
        parts = [("Pasture_pond", [(t, "Mat_Pasture_water") for t in octagon(-0.8, -0.8, 0.6, 0.42)])]
        bad = fl.violations("Pasture", parts, self.points)
        self.assertEqual(len(bad), 1)
        self.assertIn("off the ground lattice", bad[0])

    def test_level_sheet_on_slope(self):
        # The marsh's pools: whole lattice triangles, but at one level over a
        # slope, so the uphill ones stand in the ground. The outline passes;
        # the cut is what gives it away.
        region, _ = pond(self.verts, self.tris)
        level = sum(self.verts[v][2] for n in region for v in self.tris[n]) / (3 * len(region))
        water = [tuple((self.verts[v][0], self.verts[v][1], level) for v in self.tris[n]) for n in region]
        self.assertEqual(fl.alignment(water, self.points)[:2], (1.0, 1.0))
        n, worst = fl.ground_through(water, ground_tris(self.verts, self.tris))
        self.assertGreater(n, 0)
        self.assertGreater(worst, 0.01)

    def test_strip_across_lattice(self):
        # A strip cut at its own angle, across the lattice.
        a = math.radians(17)
        d, s = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
        quad = [
            (0.3 * d[0] + k * 0.1 * s[0], 0.3 * d[1] + k * 0.1 * s[1], 0.3) for k in (-1, 1)
        ] + [(-0.9 * d[0] + k * 0.1 * s[0], -0.9 * d[1] + k * 0.1 * s[1], 0.3) for k in (1, -1)]
        tris = [(quad[0], quad[1], quad[2]), (quad[0], quad[2], quad[3])]
        parts = [("Goldfield_creek", [(t, "Mat_Gold_water") for t in tris])]
        self.assertEqual(len(fl.violations("Goldfield", parts, self.points)), 1)

    def test_named_ground_feature(self):
        parts = [("Castle_track", [(t, "Mat_Pasture_mud") for t in octagon(0.2, -2.0, 0.3, 0.35)])]
        self.assertEqual(len(fl.violations("Castle", parts, self.points)), 1)

    def test_sea_tile_uses_water_directions(self):
        # Lattice triangles of the land lattice are off a sea sheet's 0/60/120.
        region, _ = pond(self.verts, self.tris)
        tris = [tuple(tuple(self.verts[v]) for v in self.tris[n]) for n in region]
        parts = [("Shoal_bars", [(t, "Mat_Shore_sand") for t in tris])]
        self.assertEqual(fl.violations("Shoal", parts, self.points, fl.LATTICE_DIRECTIONS), [])
        self.assertEqual(
            len(fl.violations("Shoal", parts, self.points, fl.WATER_LATTICE_DIRECTIONS)), 1
        )


class TestRuleAllows(unittest.TestCase):
    def setUp(self):
        self.verts, self.tris, _ = ground()
        self.points = [v[:2] for v in self.verts]
        self.round = [(t, "Mat_Pasture_water_dk") for t in octagon(0.5, 0.5, 0.3, 0.4)]

    def test_well_water(self):
        self.assertEqual(fl.violations("Spice", [("Spice_well", self.round)], self.points), [])

    def test_composed_trough_water(self):
        parts = [("Trade_Pasture_NW_hayrack_02", self.round)]
        self.assertEqual(fl.violations("Trade_Pasture_NW", parts, self.points), [])

    def test_small_puddle(self):
        tiny = [(t, "Mat_Pasture_water") for t in octagon(0.5, 0.5, 0.1, 0.4)]
        self.assertEqual(fl.violations("Pasture", [("Pasture_pond", tiny)], self.points), [])

    def test_river_tile_not_exempt(self):
        # A polygon of river water fails (no river exemption).
        parts = [("River_Pasture_E_W_A_water", [(t, "Mat_River_water") for t in octagon(0, 0, 0.6, 0.19)])]
        self.assertTrue(fl.violations("River_Pasture_E_W_A", parts, self.points))
        self.assertEqual(fl.EXEMPT, {})
        self.assertIsNone(fl.exempt_reason("River_Forest_E_W"))

    def test_river_channel_is_lattice_part(self):
        for part in ("_ground", "_channel", "_margin", "_fan"):
            self.assertIn(part, fl.LATTICE_PARTS)

    def test_capped_mound(self):
        # A closed solid is judged by what is seen from above, not cancelled
        # out by its own underside.
        top = octagon(0.0, 0.0, 0.5, 0.5)
        under = [(a, c, b) for a, b, c in octagon(0.0, 0.0, 0.5, 0.2)]
        self.assertEqual(len(fl.surfaces(top + under)), len(top))


class TestMouthSeam(unittest.TestCase):
    """The pinned mouth seam is the one exclusion, and it stays in the notch."""

    E = (hc.BORDER_APOTHEM + 0.125, 0.0)  # the east edge midpoint, blend frame

    def test_pinned_mouth_corner_in_notch(self):
        x = hc.BORDER_APOTHEM + 0.125
        self.assertTrue(fl.in_mouth_notch((x, 0.30)))
        self.assertTrue(fl.in_mouth_notch((x, -0.35)))

    def test_inside_border_not_in_notch(self):
        self.assertFalse(fl.in_mouth_notch((hc.BORDER_APOTHEM - 0.01, 0.0)))
        self.assertFalse(fl.mouth_seam((2.41, 0.1), (2.2, 0.2)))

    def test_border_away_from_mouth_not_in_notch(self):
        x = hc.BORDER_APOTHEM + 0.125
        self.assertFalse(fl.in_mouth_notch((x, 0.60)))

    def test_all_six_mouths(self):
        for k in range(6):
            t = math.pi / 3 * k
            r = hc.BORDER_APOTHEM + 0.125
            self.assertTrue(fl.in_mouth_notch((r * math.cos(t), r * math.sin(t))))

    def test_only_seam_excused(self):
        # A water strip whose last two corners are pinned at +-0.30 on the edge:
        # the seam edges run off-lattice, and only they are excused.
        x13 = 13 * fl.LATTICE_STEP * math.sqrt(3) / 2
        xe = hc.BORDER_APOTHEM + 0.125
        a, b = (x13, -0.107, 0.19), (x13, 0.107, 0.19)
        c, d = (xe, 0.30, 0.19), (xe, -0.30, 0.19)
        tris = [(a, d, c), (a, c, b)]
        pts = [p[:2] for p in (a, b, c, d)]
        on_dir, _, _ = fl.alignment(tris, pts)
        self.assertLess(on_dir, 0.95)
        on_dir, on_vert, _ = fl.alignment(tris, pts, seam=True)
        self.assertEqual(on_dir, 1.0)
        # and the same off-angle edge moved inside the border is not excused
        inner = [tuple((p[0] - 0.5, p[1], p[2])) for p in (a, d, c)]
        on_dir, _, _ = fl.alignment([tuple(inner)], [p[:2] for p in inner], seam=True)
        self.assertLess(on_dir, 0.95)


class TestContractIntegration(unittest.TestCase):
    def test_feature_violation_fails_tile(self):
        m = land(lattice_features=["Pasture_pond: water outline is off the ground lattice"])
        self.assertEqual(hc.violations(m), ["Pasture_pond: water outline is off the ground lattice"])

    def test_clean_tile_passes(self):
        self.assertEqual(hc.violations(land(lattice_features=[])), [])


if __name__ == "__main__":
    unittest.main()
