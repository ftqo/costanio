import math
import unittest

import anchors
import lattice


class TestRuleFor(unittest.TestCase):
    def test_pieces_declare_a_lattice_anchor(self):
        # Every building part shares its family's anchor: the roof, wall and
        # trim of a settlement are three unparented objects and must not be
        # centred independently.
        for part in ("Settlement_A_roof", "Settlement_A_trim", "Settlement_A_wall"):
            self.assertEqual(anchors.rule_for(part), (anchors.LCOL, anchors.LHEX))
        for part in ("City_A_roof", "City_A_wall"):
            self.assertEqual(anchors.rule_for(part), (anchors.LCOL / 2, anchors.LHEX / 2))

    def test_piece_anchors_use_lattice_units(self):
        # The showcase board is authored on the spread lattice, so a piece on a
        # vertex stands on the lattice vertex, not the tile art's corner.
        x, y = anchors.rule_for("Settlement_A_wall")
        self.assertAlmostEqual(math.hypot(x, y) / math.hypot(anchors.COL, anchors.HEX),
                               lattice.LATTICE_SCALE)

    def test_roads_anchor_on_edge_midpoint(self):
        a = anchors.rule_for("Road_A_wall")
        b = anchors.rule_for("Road_B_wall")
        self.assertEqual(a, (anchors.LCOL * 0.75, anchors.LHEX * 0.75))
        self.assertEqual(b, (anchors.LCOL * 0.25, anchors.LHEX * 0.75))
        # Both are midpoints of edges meeting at the same vertex, mirrored
        # about it, so they sit the same distance from it.
        vx, vy = anchors.LCOL / 2, anchors.LHEX / 2
        self.assertAlmostEqual((a[0] - vx) ** 2 + (a[1] - vy) ** 2, (b[0] - vx) ** 2 + (b[1] - vy) ** 2)

    def test_roads_align_to_x_axis(self):
        # Both were modelled on a real edge of the showcase board, 30 degrees
        # off axis. planPieces turns a road by the angle of the edge it spans,
        # which only works from a bar lying along +x.
        self.assertAlmostEqual(anchors.turn_for("Road_A_wall"), -math.pi / 6.0)
        self.assertAlmostEqual(anchors.turn_for("Road_A_trim"), -math.pi / 6.0)
        # Road_B is the mirrored edge, so it comes home the other way.
        self.assertAlmostEqual(anchors.turn_for("Road_B_wall"), math.pi / 6.0)
        # The two are mirror images: equal and opposite.
        self.assertAlmostEqual(
            anchors.turn_for("Road_A_wall") + anchors.turn_for("Road_B_wall"), 0.0
        )

    def test_buildings_square_to_board(self):
        # Both were composed on a showcase vertex with the turn baked into
        # their mesh. Measured off the doorway's wall in the exported glb: the
        # settlement faces 70 degrees and the city 105, against a front of 90.
        self.assertAlmostEqual(anchors.turn_for("Settlement_A_wall"), -math.radians(20.0))
        self.assertAlmostEqual(anchors.turn_for("Settlement_A_trim"), -math.radians(20.0))
        self.assertAlmostEqual(anchors.turn_for("City_A_roof"), math.radians(15.0))
        # The robber stands on a whole tile and has no frontage to square.
        self.assertEqual(anchors.turn_for("Robber_body"), 0.0)

    def test_beach_has_no_rule(self):
        # It is generated in its reference pose at the origin.
        for name in ("Beach_canonical_e0_dry", "Connector_beach_canonical_c0_wet"):
            self.assertEqual(anchors.rule_for(name), anchors.ROOT)
            self.assertEqual(anchors.turn_for(name), 0.0)

    def test_improvement_props_have_no_rule(self):
        # Authored on the world origin and never instanced on the board; the
        # shop-tile camera sets its own yaw.
        for name in (
            "Improve_Science_cover",
            "Improve_Trade_beam",
            "Improve_Politics_band",
        ):
            self.assertEqual(anchors.rule_for(name), anchors.ROOT)
            self.assertEqual(anchors.turn_for(name), 0.0)
            self.assertFalse(anchors.is_upright(name))
            self.assertFalse(anchors.is_reference(name))

    def test_default_uses_own_origin(self):
        # The robber belongs here, not with the hex-parented families: it is
        # staged on the desert's chip socket but its own origin is its centre,
        # and planRobber places it at the tile centre.
        for name in ("Hex_Forest", "Chip_06_1_body", "Hmark_wood_body", "Ship_pirate_hull", "Robber_body"):
            self.assertEqual(anchors.rule_for(name), anchors.ROOT)


class TestScaleCancel(unittest.TestCase):
    def test_water_scaled_to_art_size(self):
        for terrain in ("Ocean", "Port"):
            self.assertAlmostEqual(
                anchors.scale_cancel_for(terrain) * lattice.LATTICE_SCALE, 1.0
            )

    def test_land_and_off_board_unscaled(self):
        for terrain in ("Forest", "Hills", "Desert", "Generic", None):
            self.assertEqual(anchors.scale_cancel_for(terrain), 1.0)


class TestIsReference(unittest.TestCase):
    def test_mirror_is_reference(self):
        for name in ("Ref_Gap_Forest_e0", "Ref_Beach_1_2_e3_dry", "Ref_HarborToken"):
            self.assertTrue(anchors.is_reference(name))

    def test_real_art_not_reference(self):
        for name in ("Hex_Forest", "Beach_canonical_e0_dry", "Robber_body"):
            self.assertFalse(anchors.is_reference(name))


class TestRoots(unittest.TestCase):
    def test_root_parent_outside_set(self):
        parents = {
            "Chip_05_1_body": "Hex_Pasture",  # staged on a tile, exported alone
            "Chip_05_1_face": "Chip_05_1_body",
            "Chip_05_1_pip_01": "Chip_05_1_body",
            "Hex_Pasture": None,
        }
        exported = ["Chip_05_1_body", "Chip_05_1_face", "Chip_05_1_pip_01"]
        self.assertEqual(anchors.roots(parents, exported), ["Chip_05_1_body"])

    def test_unparented_parts_are_roots(self):
        parents = {"Settlement_A_roof": None, "Settlement_A_wall": None}
        exported = ["Settlement_A_roof", "Settlement_A_wall"]
        self.assertEqual(anchors.roots(parents, exported), exported)

    def test_root_order_matches_export(self):
        parents = {"A": None, "B": None, "C": "A"}
        self.assertEqual(anchors.roots(parents, ["B", "A", "C"]), ["B", "A"])


class TestUnstagedArt(unittest.TestCase):
    """A culture piece set carries the stock names and none of the staging."""

    def test_origin_set_uses_root_rule(self):
        # The lattice anchor on art already at the origin would drag it five
        # units off, past MAX_RESIDUAL.
        for part in ("Settlement_A_wall", "City_A_roof", "Road_A_trim", "Road_B_wall"):
            self.assertEqual(anchors.rule_for(part, staged=False), anchors.ROOT)
            self.assertNotEqual(anchors.rule_for(part), anchors.ROOT)
        x, y = anchors.rule_for("Settlement_A_wall")
        self.assertGreater(math.hypot(x, y), anchors.MAX_RESIDUAL)

    def test_square_set_has_no_turn(self):
        # This one would not fail on export: a 20-degree correction on square
        # art just ships crooked.
        for part in ("Settlement_A_wall", "City_A_wall", "Road_A_wall", "Road_B_wall"):
            self.assertEqual(anchors.turn_for(part, staged=False), 0.0)
            self.assertNotEqual(anchors.turn_for(part), 0.0)

    def test_staging_is_default(self):
        # art/pieces.blend, which both tables describe, goes through the same
        # call and must be unaffected.
        self.assertEqual(anchors.rule_for("Settlement_A_wall"), (anchors.LCOL, anchors.LHEX))
        self.assertAlmostEqual(anchors.turn_for("Road_A_wall"), -math.pi / 6.0)


class TestHexAncestor(unittest.TestCase):
    def setUp(self):
        self.is_hex = lambda n: n.startswith("Hex_")

    def test_walks_up_to_the_hex(self):
        parents = {"Robber_body": "Hex_Desert", "Hex_Desert": None}
        self.assertEqual(anchors.hex_ancestor("Robber_body", parents, self.is_hex), "Hex_Desert")

    def test_returns_self_when_hex(self):
        self.assertEqual(anchors.hex_ancestor("Hex_Ocean", {"Hex_Ocean": None}, self.is_hex), "Hex_Ocean")

    def test_none_when_no_hex_above(self):
        parents = {"Road_A_wall": None}
        self.assertIsNone(anchors.hex_ancestor("Road_A_wall", parents, self.is_hex))

    def test_parenting_cycle(self):
        parents = {"A": "B", "B": "A"}
        self.assertIsNone(anchors.hex_ancestor("A", parents, self.is_hex))


if __name__ == "__main__":
    unittest.main()
