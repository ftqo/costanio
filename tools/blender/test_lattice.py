"""Tests for lattice.py: the geometry mirror, and its agreement with the TS.

The drift tests read the numbers out of `frontend/src/lib/board3d/*.ts` and
fail if the mirror disagrees. If one fails, change `lattice.py` to match the
TypeScript, not the other way round.

The geometry tests check the mesh construction itself (n-gons and outward
normals, which the TypeScript does not need).
"""

import math
import os
import re
import unittest

import lattice

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BOARD3D = os.path.join(REPO, "frontend", "src", "lib", "board3d")


def ts_number(filename, name):
    """The literal a `const NAME = <number>;` is initialised to, as a float.

    Only matches a bare numeric literal; a constant defined as an expression
    raises rather than being skipped.
    """
    path = os.path.join(BOARD3D, filename)
    with open(path) as handle:
        source = handle.read()
    match = re.search(
        rf"^(?:export )?const {re.escape(name)}(?::\s*\w+)? = (-?[\d.]+);",
        source,
        re.MULTILINE,
    )
    if match is None:
        raise AssertionError(f"{filename} has no bare numeric const {name}")
    return float(match.group(1))


class TestConstantsMatchTypeScript(unittest.TestCase):
    def assertMirrors(self, filename, ts_name, value):
        self.assertAlmostEqual(ts_number(filename, ts_name), value, places=9,
                               msg=f"{filename}:{ts_name} has drifted from lattice.py")

    def test_hex_size(self):
        self.assertMirrors("manifest.generated.ts", "HEX_SIZE", lattice.HEX_SIZE)

    def test_lattice_gap(self):
        self.assertMirrors("coords.ts", "LATTICE_GAP", lattice.LATTICE_GAP)

    def test_gap_underlap(self):
        self.assertMirrors("gapGeometry.ts", "UNDERLAP", lattice.GAP_UNDERLAP)

    def test_gap_sand_height(self):
        self.assertMirrors("gapGeometry.ts", "SAND_Y", lattice.GAP_SAND_Z)

    def test_gap_bottom(self):
        self.assertMirrors("gapGeometry.ts", "BOTTOM_Y", lattice.GAP_BOTTOM_Z)

    def test_beach_bands(self):
        # Both bands, not the total (BEACH_WIDTH is a sum), so the split
        # between light and dark sand cannot drift.
        self.assertMirrors("beachGeometry.ts", "DRY_WIDTH", lattice.BEACH_DRY_WIDTH)
        self.assertMirrors("beachGeometry.ts", "WET_WIDTH", lattice.BEACH_WET_WIDTH)
        self.assertAlmostEqual(
            lattice.BEACH_WIDTH, lattice.BEACH_DRY_WIDTH + lattice.BEACH_WET_WIDTH, places=9
        )

    def test_beach_heights(self):
        self.assertMirrors("beachGeometry.ts", "TOP_Y", lattice.BEACH_TOP_Z)
        self.assertMirrors("beachGeometry.ts", "WATER_Y", lattice.BEACH_WATER_Z)
        self.assertMirrors("beachGeometry.ts", "BOTTOM_Y", lattice.BEACH_BOTTOM_Z)

    def test_beach_corner_facets(self):
        self.assertMirrors("beachGeometry.ts", "CORNER_FACETS", lattice.BEACH_CORNER_FACETS)

    def test_token(self):
        # No drift assertion: the sign is modelled art built from these
        # constants, with no TypeScript counterpart. Pin the shape: one sixth of a hex, six tiling it.
        tri = [(x, y) for x, y in
               [(lattice.TOKEN_ALONG_PIER - lattice.TILE_APOTHEM * lattice.TOKEN_SCALE / 2,
                 (lattice.HEX_SIZE / 2) * lattice.TOKEN_SCALE),
                (lattice.TOKEN_ALONG_PIER + lattice.TILE_APOTHEM * lattice.TOKEN_SCALE / 2, 0.0),
                (lattice.TOKEN_ALONG_PIER - lattice.TILE_APOTHEM * lattice.TOKEN_SCALE / 2,
                 -(lattice.HEX_SIZE / 2) * lattice.TOKEN_SCALE)]]
        sides = [math.hypot(tri[i][0] - tri[(i + 1) % 3][0], tri[i][1] - tri[(i + 1) % 3][1])
                 for i in range(3)]
        for side in sides:
            self.assertAlmostEqual(side, sides[0], places=6,
                                   msg="the sign is a hex sixth, so it must be equilateral")
        verts, faces = lattice.harbor_token()
        self.assertEqual(len(verts), 6)  # a triangular prism
        self.assertEqual(len(faces), 5)  # two ends, three sides

    def test_beach_width_sums_bands(self):
        # The TypeScript writes the total as an expression, so pin the
        # expression itself.
        path = os.path.join(BOARD3D, "beachGeometry.ts")
        with open(path) as handle:
            source = handle.read()
        self.assertIn("const BEACH_WIDTH = DRY_WIDTH + WET_WIDTH;", source)

    def test_water_terrains_match_renderer(self):
        # coastline.ts names the resources; naming.py maps terrain -> resource.
        import naming

        path = os.path.join(BOARD3D, "coastline.ts")
        with open(path) as handle:
            source = handle.read()
        match = re.search(r"new Set\(\[([^\]]*)\]\)", source)
        self.assertIsNotNone(match, "coastline.ts no longer declares WATER as a Set literal")
        resources = set(re.findall(r'"([^"]+)"', match.group(1)))
        # `fog` is the only resource with no art of its own; the loader falls
        # it back to the sea tile. (A lake is drawn as land.)
        resources -= {"fog"}
        # Every water terrain must map to a resource the renderer calls water,
        # allowing for the sea_port variant of `sea`.
        for terrain in lattice.WATER_TERRAINS:
            resource = naming.TERRAIN_TO_RESOURCE[terrain]
            self.assertTrue(
                any(resource.startswith(r) for r in resources),
                f"{terrain} -> {resource} is not water to the renderer",
            )


class TestLattice(unittest.TestCase):
    def test_gap_between_rims(self):
        a = lattice.axial_to_xy(0, 0)
        b = lattice.axial_to_xy(1, 0)
        centre_to_centre = math.dist(a, b)
        self.assertAlmostEqual(centre_to_centre - 2 * lattice.TILE_APOTHEM, lattice.LATTICE_GAP)

    def test_water_fills_its_cell(self):
        # A water tile scaled by LATTICE_SCALE has apothem LATTICE_APOTHEM, so
        # two adjacent ones touch exactly and the sea has no seam in it.
        self.assertAlmostEqual(lattice.TILE_APOTHEM * lattice.LATTICE_SCALE, lattice.LATTICE_APOTHEM)

    def test_axial_round_trip(self):
        for q, r in [(0, 0), (1, 0), (-2, 1), (3, -2)]:
            x, y = lattice.axial_to_xy(q, r, lattice.HEX_SIZE)
            got = lattice.xy_to_axial(x, y, lattice.HEX_SIZE)
            self.assertAlmostEqual(got[0], q)
            self.assertAlmostEqual(got[1], r)

    def test_edge_turn(self):
        # Edge k's midpoint is the neighbour's centre, halved. Turning edge 0's
        # midpoint by edge_turn(k) has to land on it (checking six distinct
        # multiples of 60 would also pass a mirrored board).
        m0 = [c / 2 for c in lattice.axial_to_xy(*lattice.neighbor(0, 0, 0))]
        for k in range(6):
            want = [c / 2 for c in lattice.axial_to_xy(*lattice.neighbor(0, 0, k))]
            a = lattice.edge_turn(k)
            got = (
                m0[0] * math.cos(a) - m0[1] * math.sin(a),
                m0[0] * math.sin(a) + m0[1] * math.cos(a),
            )
            self.assertAlmostEqual(got[0], want[0], places=9, msg=f"edge {k}")
            self.assertAlmostEqual(got[1], want[1], places=9, msg=f"edge {k}")


class TestGapStrip(unittest.TestCase):
    def test_spans_rim_to_midline(self):
        verts, _ = lattice.gap_strip()
        xs = [v[0] for v in verts]
        self.assertAlmostEqual(max(xs), lattice.LATTICE_APOTHEM)
        self.assertAlmostEqual(min(xs), (lattice.TILE_APOTHEM - lattice.GAP_UNDERLAP))

    def test_below_tile_top(self):
        verts, _ = lattice.gap_strip()
        self.assertAlmostEqual(max(v[2] for v in verts), lattice.GAP_SAND_Z)
        # The land tile's own top face, which the gutter sand fills up to but
        # not past. Order: beach 0.215, gutter 0.22, tile 0.25.
        self.assertLess(lattice.GAP_SAND_Z, lattice.TILE_TOP_Z)
        self.assertLess(lattice.BEACH_TOP_Z, lattice.GAP_SAND_Z)

    def test_six_close_a_ring(self):
        # The inner boundary is the tile hexagon scaled about its centre, not
        # the edge pushed straight in, so one strip's radial side lands exactly
        # on the next one's after a 60-degree turn.
        verts, _ = lattice.gap_strip()
        turn = lattice.edge_turn(1)
        rotated = {
            (
                round(x * math.cos(turn) - y * math.sin(turn), 9),
                round(x * math.sin(turn) + y * math.cos(turn), 9),
                round(z, 9),
            )
            for x, y, z in verts
        }
        original = {(round(x, 9), round(y, 9), round(z, 9)) for x, y, z in verts}
        self.assertEqual(len(original & rotated), 4, "adjacent gap strips do not share a side")


class TestBeach(unittest.TestCase):
    def test_bands_meet(self):
        self.assertEqual(lattice.beach_span("dry")[1], lattice.beach_span("wet")[0])

    def test_strip_starts_at_water_rim(self):
        verts, _ = lattice.beach_strip("dry")
        self.assertAlmostEqual(max(v[0] for v in verts), lattice.BEACH_APOTHEM)

    def test_strip_spans_a_full_edge(self):
        verts, _ = lattice.beach_strip("wet")
        ys = [v[1] for v in verts]
        self.assertAlmostEqual(max(ys) - min(ys), lattice.LATTICE_SIZE)

    def test_beach_leaves_strait_open(self):
        # Two facing coasts across a one-hex strait are 2*APOTHEM apart.
        self.assertLess(2 * lattice.BEACH_WIDTH, 2 * lattice.BEACH_APOTHEM)

    def test_dry_sand_level_with_land(self):
        verts, _ = lattice.beach_strip("dry")
        self.assertAlmostEqual(max(v[2] for v in verts), lattice.BEACH_TOP_Z)

    def test_wet_sand_shelves_down(self):
        verts, _ = lattice.beach_strip("wet")
        self.assertAlmostEqual(max(v[2] for v in verts), lattice.BEACH_TOP_Z)
        self.assertAlmostEqual(min(v[2] for v in verts), lattice.BEACH_BOTTOM_Z)
        tops = sorted({round(v[2], 9) for v in verts})
        self.assertIn(round(lattice.BEACH_WATER_Z, 9), tops)

    def test_dry_connector_collapses(self):
        verts, faces = lattice.beach_connector("dry")
        # 1 facet + 1 apex = 3 top points, so 6 verts and 3 sides + 2 caps.
        self.assertEqual(len(verts), 6)
        self.assertEqual(len(faces), 5)

    def test_connector_matches_strip_section(self):
        # Its outer arc has to reach exactly as far from the corner as the
        # strip reaches from the edge, or the two leave a seam.
        apex = (lattice.BEACH_APOTHEM, -lattice.LATTICE_SIZE / 2.0)
        verts, _ = lattice.beach_connector("wet")
        radii = sorted({round(math.dist((v[0], v[1]), apex), 6) for v in verts})
        self.assertAlmostEqual(radii[0], lattice.BEACH_DRY_WIDTH, places=6)
        self.assertAlmostEqual(radii[-1], lattice.BEACH_WIDTH, places=6)


class TestCoastline(unittest.TestCase):
    def test_lone_island_ringed(self):
        strips, corners = lattice.solve_coastline([(0, 0)])
        self.assertEqual(len(strips), 6)
        # Every vertex of a single hex is convex, so all six are filled.
        self.assertEqual(len(corners), 6)

    def test_strips_on_water_hex(self):
        strips, _ = lattice.solve_coastline([(0, 0)])
        for hexc, _ in strips:
            self.assertNotEqual(hexc, (0, 0))

    def test_straight_coast_no_connectors(self):
        # Three in a row: the water hex north of the middle one must not fill
        # its interior vertices, where its own strips already overlap.
        strips, corners = lattice.solve_coastline([(0, 0), (1, 0), (2, 0)])
        by_hex = {}
        for hexc, _ in strips:
            by_hex[hexc] = by_hex.get(hexc, 0) + 1
        interior = [h for h, n in by_hex.items() if n > 1]
        self.assertTrue(interior, "no water hex borders two of the three tiles")
        for hexc in interior:
            runs = sum(1 for h, _ in corners if h == hexc)
            self.assertEqual(runs, 1, f"{hexc} should end exactly one coastal run")

    def test_output_is_ordered(self):
        land = [(0, 0), (1, 0), (0, 1)]
        self.assertEqual(lattice.solve_coastline(land), lattice.solve_coastline(reversed(land)))


class TestPrism(unittest.TestCase):
    def test_face_count(self):
        verts, faces = lattice.prism([(0, 0), (1, 0), (0, 1)], 1.0, 0.0)
        self.assertEqual(len(verts), 6)
        self.assertEqual(len(faces), 5)  # top, bottom, three sides

    def test_winding_is_normalised(self):
        ccw = [(0, 0), (1, 0), (0, 1)]
        cw = list(reversed(ccw))
        self.assertEqual(lattice.prism(ccw, 1.0, 0.0), lattice.prism(cw, 1.0, 0.0))

    def test_normals_point_out(self):
        verts, faces = lattice.prism([(1, 0), (0, 1), (-1, 0), (0, -1)], 1.0, -1.0)
        centre = (0.0, 0.0, 0.0)
        for face in faces:
            a, b, c = (verts[i] for i in face[:3])
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - b[i] for i in range(3)]
            n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ]
            outward = [a[i] - centre[i] for i in range(3)]
            self.assertGreater(sum(n[i] * outward[i] for i in range(3)), 0, f"face {face} faces inward")


if __name__ == "__main__":
    unittest.main()
