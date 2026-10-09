"""The hex contract's rules, tested without launching Blender.

`check_hexes.py` checks the real tiles against the contract. This checks that
the contract still rejects broken tiles.
"""

import math
import unittest
import unittest.mock

import hexcontract as hc


def rim(**over):
    """The rim seven of the eight shipped land tiles measure as.

    Measured off `art/hexes/*.blend`: Desert, Fields, Forest, Gold, Hills,
    Mountains and Pasture share one border mesh. Generic has its own fixture
    below.
    """
    m = {
        "name": "Fields_rim",
        "apothem_min": 2.4731,
        "apothem_max": 2.5981,
        "outer_z_min": 0.2205,
        "outer_z_max": 0.2205,
        "inner_z_min": 0.29,
        "inner_z_max": 0.29,
        "cutbank": 0.0135,
        "cutbank_apothem": 2.5975,
        "outline_material": "Mat_Fields_plough_dk",
        "annulus_gaps": 0,
    }
    m.update(over)
    return m


def generic_rim(**over):
    """Generic's: a bare 0.030 feather in one material. No lip either way."""
    return rim(
        name="Generic_rim",
        apothem_min=2.4731,
        outer_z_min=0.22,
        outer_z_max=0.22,
        inner_z_min=0.25,
        inner_z_max=0.25,
        cutbank=0.0,
        cutbank_apothem=None,
        outline_material=None,
        **over,
    )


def land(**over):
    """A measurement of a land tile that passes every rule."""
    m = {
        "terrain": "Fields",
        "resource": "wheat",
        "water": False,
        "slab_is_mesh": True,
        "slab_type": "MESH",
        "slab_circumradius": hc.LAND_CIRCUMRADIUS,
        "slab_top_z": hc.LAND_TOP_Z,
        "slab_bottom_z": hc.LAND_BOTTOM_Z,
        "border_reach": hc.BORDER_APOTHEM,
        "border_reach_object": "Fields_ground",
        "border_intrusions": [],
        "tallest_z": 1.4771,
        "tallest_object": "Fields_scarecrow",
        "socket": {
            "name": "Token_Fields",
            "type": "EMPTY",
            "empty_display_type": "CIRCLE",
            "offset": [0.0, 1.5, hc.SOCKET_Z],
        },
        "keep_clear_intrusions": [],
        "rim": rim(),
        "rim_buried_by": [],
        "meshes": 7,
        "pointy_top": True,
    }
    m.update(over)
    return m


def water(**over):
    m = {
        "terrain": "Ocean",
        "resource": "sea",
        "water": True,
        "slab_is_mesh": True,
        "slab_type": "MESH",
        "slab_circumradius": hc.WATER_CIRCUMRADIUS,
        "slab_top_z": hc.WATER_TOP_Z,
        "slab_bottom_z": hc.WATER_BOTTOM_Z,
        "border_reach": 0.0,
        "border_reach_object": None,
        "border_intrusions": [],
        "tallest_z": 0.217,
        "tallest_object": "Ocean_waves",
        "socket": None,
        "keep_clear_intrusions": [],
        # Water fills its whole lattice cell and has no land surface to ramp,
        # so it carries no rim and none of the rim rules apply to it.
        "rim": None,
        "rim_buried_by": [],
        "meshes": 2,
        "pointy_top": True,
    }
    m.update(over)
    return m


class TestPasses(unittest.TestCase):
    def test_good_land_tile(self):
        self.assertEqual(hc.violations(land()), [])

    def test_good_water_tile(self):
        self.assertEqual(hc.violations(water()), [])

    def test_generic_mounts_its_chip_dead_centre(self):
        m = land(terrain="Generic", slab_circumradius=2.9856, rim=generic_rim())
        m["socket"]["offset"] = [0.0, 0.0, hc.SOCKET_Z]
        self.assertEqual(hc.violations(m), [])


class TestRim(unittest.TestCase):
    """The border round every land tile.

    Each test is one way a rim can be missing or wrong.
    """

    def test_shared_border_passes(self):
        self.assertEqual(hc.rim_violations(land()), [])

    def test_missing_rim_fails(self):
        bad = hc.rim_violations(land(rim=None))
        self.assertTrue(any("no Fields_rim mesh" in v for v in bad), bad)

    def test_water_needs_none(self):
        self.assertEqual(hc.rim_violations(water(rim=None)), [])
        self.assertEqual(hc.rim_violations(water(terrain="Port", rim=None)), [])

    def test_high_slab_buries_rim(self):
        # The chamfer under the slab's own top face renders as nothing.
        bad = hc.rim_violations(land(slab_top_z=0.25))
        self.assertTrue(any("buries Fields_rim" in v for v in bad), bad)

    def test_apron_over_chamfer_fails(self):
        bad = hc.rim_violations(
            land(rim_buried_by=[("Fields_ground", 0.2550, 2.5700)])
        )
        self.assertTrue(any("Fields_ground" in v for v in bad), bad)

    def test_apron_at_gutter_passes(self):
        # The measurer only reports what is above the gutter height and below
        # the rim's own inner edge, so a clamped apron or an overhanging palm
        # produces no entry.
        self.assertEqual(hc.rim_violations(land(rim_buried_by=[])), [])

    def test_rim_short_of_apothem_fails(self):
        bad = hc.rim_violations(land(rim=rim(apothem_max=2.55)))
        self.assertTrue(any("art apothem" in v for v in bad), bad)

    def test_outer_edge_at_slab_top_fails(self):
        bad = hc.rim_violations(land(rim=rim(outer_z_min=0.25, outer_z_max=0.25)))
        self.assertTrue(any("outer edge z" in v for v in bad), bad)

    def test_tie_break_limit(self):
        ok = rim(outer_z_min=hc.CHAMFER_OUTER_HEIGHT + hc.RIM_TIE_BREAK,
                 outer_z_max=hc.CHAMFER_OUTER_HEIGHT + hc.RIM_TIE_BREAK)
        self.assertEqual(hc.rim_violations(land(rim=ok)), [])
        bad = hc.rim_violations(land(rim=rim(outer_z_min=0.23, outer_z_max=0.23)))
        self.assertTrue(any("outer edge z" in v for v in bad), bad)

    def test_flat_rim_fails(self):
        # Same height in and out: a decal, not a chamfer.
        bad = hc.rim_violations(land(rim=rim(inner_z_min=0.2205, inner_z_max=0.2205)))
        self.assertTrue(any("rises" in v for v in bad), bad)

    def test_hole_over_overlap_fails(self):
        bad = hc.rim_violations(land(rim=rim(annulus_gaps=17)))
        self.assertTrue(any("uncovered" in v for v in bad), bad)
        self.assertTrue(any("z-fights" in v for v in bad), bad)

    def test_plain_feather_fails(self):
        # No cutbank, no outline material: a plain feather, which reads worse
        # than no rim.
        bad = hc.rim_violations(land(rim=rim(cutbank=0.0, outline_material=None)))
        self.assertTrue(any("no visible lip" in v for v in bad), bad)

    def test_cutbank_alone_is_a_lip(self):
        tall = rim(cutbank=hc.RIM_CUTBANK_MIN, outline_material=None)
        self.assertEqual(hc.rim_violations(land(rim=tall)), [])

    def test_outline_material_alone_is_a_lip(self):
        # How the shipped tiles pass: their cutbank measures 0.0135, under the
        # floor, and the dark outer band carries the edge.
        flat = rim(cutbank=0.0, outline_material="Mat_Fields_plough_dk")
        self.assertEqual(hc.rim_violations(land(rim=flat)), [])

    def test_shipped_cutbank_alone_fails(self):
        bad = hc.rim_violations(land(rim=rim(outline_material=None)))
        self.assertTrue(any("0.0135" in v for v in bad), bad)


class TestSlab(unittest.TestCase):
    def test_wrong_circumradius_fails(self):
        bad = hc.violations(land(slab_circumradius=3.2))
        self.assertTrue(any("circumradius" in v for v in bad), bad)

    def test_water_rejects_land_circumradius(self):
        bad = hc.violations(water(slab_circumradius=hc.LAND_CIRCUMRADIUS))
        self.assertTrue(any("circumradius" in v for v in bad), bad)

    def test_slab_sunk_in_z_fails(self):
        bad = hc.violations(land(slab_top_z=0.10, slab_bottom_z=-0.37))
        self.assertTrue(any("slab_top_z" in v for v in bad), bad)

    def test_wrong_thickness_fails(self):
        bad = hc.violations(land(slab_bottom_z=-0.60))
        self.assertTrue(any("thickness" in v or "bottom" in v for v in bad), bad)

    def test_slab_must_be_a_mesh(self):
        bad = hc.violations(land(slab_is_mesh=False, slab_type="EMPTY"))
        self.assertTrue(any("MESH" in v for v in bad), bad)


class TestBorder(unittest.TestCase):
    """The drawn border, measured in the hexagon's own metric.

    Mid-edge the border is at the apothem, not the circumradius, so a radial
    check would pass art hanging 0.40 across the gutter.
    """

    def m(self, terrain, name, *pts):
        m = land(terrain=terrain) if terrain not in hc.WATER else water(terrain=terrain)
        m["border_intrusions"] = hc.border_intrusions(terrain, [(name, list(pts))])
        return m

    def test_border_is_rim_inner_edge(self):
        self.assertAlmostEqual(hc.BORDER_APOTHEM, 2.4731, places=4)
        self.assertAlmostEqual(hc.BORDER_APOTHEM, hc.CHAMFER_OUTER_EDGE - hc.CHAMFER_WIDTH)
        self.assertAlmostEqual(hc.BORDER_APOTHEM, hc.RIM_ANNULUS_INNER - (hc.CHAMFER_WIDTH - 0.06))

    def test_mid_edge_past_apothem_fails(self):
        # (2.7, 0): radius 2.70, under 3.0, but 0.10 beyond the art hexagon's
        # own +x edge.
        self.assertLess(math.hypot(2.7, 0.0), hc.LAND_CIRCUMRADIUS)
        bad = hc.violations(self.m("Fields", "Fields_hedgerow", (2.7, 0.0, 0.4)))
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("Fields_hedgerow", bad[0])
        self.assertIn(f"{2.7 - hc.BORDER_APOTHEM:.4f} past the border", bad[0])

    def test_on_chamfer_fails(self):
        # 2.55 out on the NE edge's normal: inside the art hexagon (2.598),
        # but over the rim the lip is drawn on.
        x, y = 2.55 * math.cos(math.pi / 3), 2.55 * math.sin(math.pi / 3)
        bad = hc.violations(self.m("Fields", "Fields_scarecrow", (x, y, 0.4)))
        self.assertTrue(any("Fields_scarecrow" in v for v in bad), bad)
        # ...and on the line itself, to the tolerance, it passes.
        x, y = hc.BORDER_APOTHEM * math.cos(math.pi / 3), hc.BORDER_APOTHEM * math.sin(math.pi / 3)
        self.assertEqual(hc.violations(self.m("Fields", "Fields_scarecrow", (x, y, 0.4))), [])

    def test_corner_point_inside_border(self):
        # 2.80 out along a corner bearing is apothem 2.425: inside.
        x, y = 0.0, 2.8
        self.assertLess(hc.apothem(x, y), hc.BORDER_APOTHEM)
        self.assertEqual(hc.violations(self.m("Fields", "Fields_hedgerow", (x, y, 0.4))), [])

    def test_rim_and_slab_exempt(self):
        edge = (2.598, 0.0, 0.2205)
        self.assertEqual(hc.violations(self.m("Fields", "Fields_rim", edge)), [])
        self.assertEqual(hc.violations(self.m("Fields", "Hex_Fields", edge)), [])
        # ...and only those: the ground is art like any other.
        self.assertNotEqual(hc.violations(self.m("Fields", "Fields_ground", edge)), [])

    def test_river_crosses_only_at_mouth(self):
        t = "River_Pasture_E_W_A"
        at_mouth = (2.598, 0.30, 0.193)
        self.assertEqual(hc.violations(self.m(t, f"{t}_water", at_mouth)), [])
        self.assertEqual(hc.violations(self.m(t, f"{t}_channel", (2.598, -0.35, 0.2205))), [])
        # Beside the notch, under the rim: still past the line.
        self.assertNotEqual(hc.violations(self.m(t, f"{t}_water", (2.536, 0.413, 0.193))), [])
        # In the notch but standing up out of it.
        self.assertNotEqual(hc.violations(self.m(t, f"{t}_channel", (2.598, 0.1, 0.30))), [])
        # A prop is not a mouth part however low it sits.
        self.assertNotEqual(hc.violations(self.m(t, f"{t}_bankrock_01", at_mouth)), [])

    def test_water_border_apothem(self):
        self.assertAlmostEqual(hc.WATER_BORDER_APOTHEM, 2.5981, places=4)
        self.assertEqual(hc.violations(self.m("Ocean", "Ocean_waves", (2.72, 0.0, 0.18))), [])
        self.assertNotEqual(hc.violations(self.m("Shoal", "Shoal_bars", (2.62, 0.0, 0.25))), [])
        self.assertEqual(hc.violations(self.m("Shoal", "Shoal_bars", (2.58, 0.0, 0.25))), [])

    def test_pier_exception(self):
        pier = (2.697, 0.0, 0.27)
        self.assertEqual(hc.violations(self.m("Port", "Port_deck", pier)), [])
        self.assertNotEqual(hc.violations(self.m("Port", "Port_frame", pier)), [])
        self.assertNotEqual(hc.violations(self.m("Ocean", "Port_deck", pier)), [])

    def test_intrusions_sorted_worst_first(self):
        got = hc.border_intrusions(
            "Fields",
            [
                ("Fields_a", [(2.50, 0.0, 0.3), (2.60, 0.0, 0.3)]),
                ("Fields_b", [(2.70, 0.0, 0.3)]),
                ("Fields_c", [(1.0, 0.0, 0.3)]),
            ],
        )
        self.assertEqual([g[0] for g in got], ["Fields_b", "Fields_a"])
        self.assertAlmostEqual(got[1][1], 2.60, places=4)


class TestHeight(unittest.TestCase):
    def test_tower_fails(self):
        bad = hc.violations(land(tallest_z=3.0, tallest_object="Fields_obelisk"))
        self.assertTrue(any("ceiling" in v for v in bad), bad)

    def test_tallest_tile_fits(self):
        # Mountains_massif at 2.290 is what the ceiling was chosen against.
        self.assertEqual(hc.violations(land(terrain="Mountains", tallest_z=2.290)), [])


class TestChipSocket(unittest.TestCase):
    def test_drifted_socket_fails(self):
        # The chip socket drifted off its mount.
        m = land(terrain="Desert")
        m["socket"]["offset"] = [-0.0189, 1.3353, hc.SOCKET_Z]
        bad = hc.violations(m)
        self.assertTrue(any("chip socket at" in v for v in bad), bad)

    def test_missing_socket_fails(self):
        bad = hc.violations(land(socket=None))
        self.assertTrue(any("missing chip socket" in v for v in bad), bad)

    def test_water_socket_fails(self):
        m = water(socket={
            "name": "Token_Ocean",
            "type": "EMPTY",
            "empty_display_type": "CIRCLE",
            "offset": [0.0, 1.5, hc.SOCKET_Z],
        })
        bad = hc.violations(m)
        self.assertTrue(any("water tile carries" in v for v in bad), bad)

    def test_socket_must_be_a_circle_empty(self):
        m = land()
        m["socket"]["type"] = "MESH"
        self.assertTrue(any("expected an EMPTY" in v for v in hc.violations(m)), m)

    def test_socket_at_the_wrong_height_fails(self):
        m = land()
        m["socket"]["offset"] = [0.0, 1.5, 0.30]
        self.assertTrue(any("socket z" in v for v in hc.violations(m)))


class TestKeepClear(unittest.TestCase):
    def test_prop_through_chip_fails(self):
        # A conifer planted on the north point, which is the socket.
        bad = hc.violations(land(keep_clear_intrusions=[("Fields_oak", 1.52, 0.10)]))
        self.assertTrue(any("Fields_oak" in v for v in bad), bad)

    def test_geometry_under_chip_passes(self):
        # Below the chip's underside: hidden by it, harms nothing. The
        # measurer only reports vertices above CHIP_UNDERSIDE_Z at all.
        self.assertEqual(hc.violations(land(keep_clear_intrusions=[])), [])


class TestKnownDrift(unittest.TestCase):
    """Recorded drift passes at its measured value and nowhere else."""

    def generic(self, circumradius):
        # Generic is the shop counter: its chip mounts dead centre, not north.
        m = land(terrain="Generic", slab_circumradius=circumradius)
        m["socket"]["offset"] = [0.0, 0.0, hc.SOCKET_Z]
        return m

    def test_generic_slab_passes_at_its_measured_value(self):
        self.assertEqual(hc.violations(self.generic(2.9856)), [])

    def test_generic_slab_further_drift_fails(self):
        bad = hc.violations(self.generic(2.95))
        self.assertTrue(any("known drift" in v for v in bad), bad)

    def test_desert_has_no_waiver(self):
        # The desert has no waiver.
        bad = hc.violations(land(terrain="Desert", slab_circumradius=2.9856))
        self.assertTrue(any("circumradius" in v for v in bad), bad)

    def test_fields_has_no_waiver(self):
        # Fields has no exemption, so the value Generic is allowed fails here.
        bad = hc.violations(land(terrain="Fields", slab_circumradius=2.9856))
        self.assertTrue(any("circumradius" in v for v in bad), bad)

    def test_water_slab_height_waiver(self):
        # No tile carries a slab-height waiver, so the mechanism is exercised
        # against one added for the length of the test.
        low = dict(slab_top_z=0.1572, slab_bottom_z=-0.2620)
        self.assertNotEqual(hc.violations(water(terrain="Ocean", **low)), [])
        with unittest.mock.patch.dict(
            hc.KNOWN_DRIFT,
            {("Ocean", "slab_top_z"): 0.1572, ("Ocean", "slab_bottom_z"): -0.2620},
        ):
            self.assertEqual(hc.violations(water(terrain="Ocean", **low)), [])

    def test_keep_clear_waiver_is_per_object(self):
        # No tile carries a keep-clear waiver, so the mechanism is exercised
        # against one added for the length of the test.
        with unittest.mock.patch.dict(
            hc.KNOWN_DRIFT, {("Forest", "chip_keep_clear"): "Forest_rim"}
        ):
            ok = land(terrain="Forest", keep_clear_intrusions=[("Forest_rim", 0.2750, 1.011)])
            self.assertEqual(hc.violations(ok), [])
            bad = hc.violations(
                land(terrain="Forest", keep_clear_intrusions=[("Forest_conifers", 1.52, 0.10)])
            )
            self.assertTrue(any("Forest_conifers" in v for v in bad), bad)

    def test_bare_feather_waived_on_generic_only(self):
        m = land(terrain="Generic", slab_circumradius=2.9856, rim=generic_rim())
        m["socket"]["offset"] = [0.0, 0.0, hc.SOCKET_Z]
        self.assertEqual(hc.rim_violations(m), [])
        # The same rim on any other tile is the plain feather the rule bans.
        bad = hc.rim_violations(land(terrain="Fields", rim=generic_rim()))
        self.assertTrue(any("no visible lip" in v for v in bad), bad)

    def test_generic_waiver_covers_lip_only(self):
        bad = hc.rim_violations(
            land(terrain="Generic", rim=generic_rim(annulus_gaps=9, apothem_max=2.55))
        )
        self.assertTrue(any("uncovered" in v for v in bad), bad)
        self.assertTrue(any("art apothem" in v for v in bad), bad)
        self.assertFalse(any("visible lip" in v for v in bad), bad)

    def test_lake_rim_waived(self):
        self.assertEqual(hc.rim_violations(land(terrain="Lake", rim=None)), [])

    def test_waived_tile_rim_still_checked(self):
        # The waiver excuses absence; a rim that exists must still pass.
        bad = hc.rim_violations(land(terrain="Lake", rim=rim(annulus_gaps=4)))
        self.assertTrue(any("uncovered" in v for v in bad), bad)

    def test_oasis_rim_required(self):
        # The oasis has a rim, so losing it fails like any other land tile.
        self.assertNotIn(("Oasis", "rim"), hc.KNOWN_DRIFT)
        bad = hc.rim_violations(land(terrain="Oasis", rim=None))
        self.assertTrue(any("no Oasis_rim mesh" in v for v in bad), bad)

    def test_oasis_rim_passes(self):
        # What `gen/oasis.py` builds, measured by `make check-hexes`: the
        # desert's own profile in the oasis's palette.
        built = rim(
            name="Oasis_rim",
            outline_material="Mat_Oasis_gravel",
            cutbank=0.0135,
        )
        self.assertEqual(hc.rim_violations(land(terrain="Oasis", rim=built)), [])

    def test_forest_rim_not_waived(self):
        bad = hc.violations(
            land(terrain="Forest", keep_clear_intrusions=[("Forest_rim", 0.2750, 1.011)])
        )
        self.assertTrue(any("Forest_rim" in v for v in bad), bad)


class TestOrientation(unittest.TestCase):
    def test_pointy_top_has_a_corner_due_north(self):
        corners = [math.pi / 2 + i * math.pi / 3 for i in range(6)]
        self.assertTrue(hc.orientation_ok(corners))

    def test_flat_top_does_not(self):
        corners = [i * math.pi / 3 for i in range(6)]
        self.assertFalse(hc.orientation_ok(corners))


class TestConstants(unittest.TestCase):
    def test_land_slab_meets_gutter_sand(self):
        # The rim ramps down to the gutter fill, so the two must agree.
        import lattice

        self.assertEqual(hc.LAND_TOP_Z, lattice.GAP_SAND_Z)
        self.assertEqual(hc.CHAMFER_OUTER_HEIGHT, lattice.GAP_SAND_Z)

    def test_chamfer_is_half_the_gutter(self):
        import lattice

        self.assertAlmostEqual(hc.CHAMFER_WIDTH, lattice.LATTICE_GAP / 2.0)
        self.assertAlmostEqual(hc.CHAMFER_WIDTH, 0.125)

    def test_keep_clear_exceeds_chip(self):
        self.assertGreater(hc.KEEP_CLEAR_RADIUS, hc.CHIP_RADIUS)

    def test_annulus_is_gutter_underlap(self):
        # 2.538 is where the gutter sand stops reaching back under the tile,
        # and so where the two stop being coplanar.
        import lattice

        self.assertAlmostEqual(hc.RIM_ANNULUS_OUTER, lattice.TILE_APOTHEM)
        self.assertAlmostEqual(
            hc.RIM_ANNULUS_OUTER - hc.RIM_ANNULUS_INNER, lattice.GAP_UNDERLAP
        )
        self.assertAlmostEqual(hc.RIM_ANNULUS_INNER, 2.538, places=3)

    def test_chamfer_wider_than_annulus(self):
        import lattice

        self.assertGreater(hc.CHAMFER_WIDTH, lattice.GAP_UNDERLAP)


class TestApothem(unittest.TestCase):
    """The rim is a hexagonal ring, so it is measured in hexagons."""

    def test_edge_midpoint(self):
        # Due east is an edge normal on a pointy-top hex with a corner north.
        self.assertAlmostEqual(hc.apothem(2.5981, 0.0), 2.5981)

    def test_corner(self):
        # The north corner of the art hexagon is 3.0 from the centre and sits
        # on the ring whose apothem is 2.5981. Radius would call it outside.
        self.assertAlmostEqual(hc.apothem(0.0, 3.0), hc.CHAMFER_OUTER_EDGE, places=4)

    def test_constant_round_a_ring(self):
        want = hc.CHAMFER_OUTER_EDGE
        for i in range(60):
            angle = 2 * math.pi * i / 60
            r = want / hc.apothem(math.cos(angle), math.sin(angle))
            got = hc.apothem(r * math.cos(angle), r * math.sin(angle))
            self.assertAlmostEqual(got, want, places=6)

    def test_centre_is_zero(self):
        self.assertAlmostEqual(hc.apothem(0.0, 0.0), 0.0)


class DerivedTiles(unittest.TestCase):
    """A recipe-built tile inherits its base tile's recorded drift, and nothing more."""

    def tearDown(self):
        hc.DERIVES_FROM.clear()

    def test_lake_town_inherits_rim_waiver(self):
        m = land(terrain="Trade_Lake_W", rim=None)
        self.assertTrue(any("Trade_Lake_W_rim" in v for v in hc.violations(m)))
        hc.DERIVES_FROM["Trade_Lake_W"] = "Lake"
        self.assertEqual([v for v in hc.violations(m) if "rim" in v], [])

    def test_inheritance_by_base_not_name(self):
        # A town on the fields gets no waiver the fields do not have.
        hc.DERIVES_FROM["Trade_Fields_W"] = "Fields"
        m = land(terrain="Trade_Fields_W", rim=None)
        self.assertTrue(any("no Trade_Fields_W_rim" in v for v in hc.violations(m)))

    def test_other_rules_still_apply(self):
        hc.DERIVES_FROM["Trade_Lake_W"] = "Lake"
        m = land(terrain="Trade_Lake_W", rim=None, tallest_z=2.5)
        self.assertTrue(any("ceiling" in v for v in hc.violations(m)))


if __name__ == "__main__":
    unittest.main()
