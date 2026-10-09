import unittest

import naming


class TestNaming(unittest.TestCase):
    def test_hex_terrain(self):
        self.assertEqual(naming.hex_terrain("Hex_Desert"), "Desert")
        self.assertEqual(naming.hex_terrain("Hex_Mountains"), "Mountains")
        self.assertIsNone(naming.hex_terrain("Desert_cactus_01"))
        self.assertIsNone(naming.hex_terrain("Hex_Nonsense"))

    def test_socket_terrain(self):
        self.assertEqual(naming.socket_terrain("Token_Gold"), "Gold")
        self.assertIsNone(naming.socket_terrain("Chip_06_1_body"))

    def test_terrain_to_resource(self):
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Forest"], "wood")
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Hills"], "brick")
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Desert"], "none")
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Ocean"], "sea")
        # The oasis has no engine resource. It is in this table so the
        # exporter opens art/hexes/oasis.blend and `check_hexes` holds it to
        # the contract. See frontend/src/lib/board3d/layers/caravans.ts.
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Oasis"], "oasis")
        # The lake has art of its own; nothing may fall it back to the sea.
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Lake"], "lake")
        self.assertEqual(naming.hex_terrain("Hex_Lake"), "Lake")
        self.assertEqual(naming.socket_terrain("Token_Lake"), "Lake")
        self.assertEqual(naming.hex_terrain("Hex_Oasis"), "Oasis")
        self.assertEqual(naming.socket_terrain("Token_Oasis"), "Oasis")
        # The Raiders castle, like the oasis: a manifest key, not a wire
        # resource, listed so it is exported and checked.
        self.assertEqual(naming.TERRAIN_TO_RESOURCE["Castle"], "castle")
        self.assertEqual(naming.hex_terrain("Hex_Castle"), "Castle")
        self.assertEqual(naming.socket_terrain("Token_Castle"), "Castle")

    def test_parse_chip(self):
        self.assertEqual(naming.parse_chip("Chip_06_2_numeral"), (6, 2, "numeral"))
        self.assertEqual(naming.parse_chip("Chip_11_1_pip_02"), (11, 1, "pip_02"))
        self.assertEqual(naming.parse_chip("Chip_02_1_body"), (2, 1, "body"))
        self.assertIsNone(naming.parse_chip("Chip_blank_body"))
        self.assertIsNone(naming.parse_chip("Hex_Desert"))

    def test_is_tint_material(self):
        self.assertTrue(naming.is_tint_material("Seat_Body"))
        self.assertTrue(naming.is_tint_material("Seat_Shade"))
        self.assertFalse(naming.is_tint_material("Mat_Desert"))
        # The city-improvement props belong to no player, so their materials
        # are Mat_Improve_*, not Seat_*.
        for part in ("body", "shade", "detail"):
            for track in ("Science", "Trade", "Politics"):
                self.assertFalse(naming.is_tint_material(f"Mat_Improve_{track}_{part}"))

    def test_trade_parts(self):
        self.assertEqual(naming.parse_trade_part("Town_W_house_03"), ("Town", "W", "house", 3, "rigid"))
        self.assertEqual(naming.parse_trade_part("Town_SW_plaza"), ("Town", "SW", "plaza", None, "drape"))
        self.assertEqual(naming.parse_trade_part("Town_W_bed")[4], "bed")
        self.assertEqual(naming.parse_trade_part("LakeTown_NE_boardwalk_02")[4], "fixed")
        # A Town is a family, and there are two: E, NE, NW and SE are made
        # from them, never authored.
        self.assertIsNone(naming.parse_trade_part("Town_E_house_01"))
        self.assertIsNone(naming.parse_trade_part("Trade_W_house1"))
        self.assertEqual(naming.parse_trade_hero("Hero_Hills_kiln"), ("Hills", "kiln"))
        self.assertIsNone(naming.parse_trade_hero("Hero_Ocean_kiln"))
        self.assertEqual(naming.parse_trade_spot("Spot_Forest_NW_stand_alt"), ("Forest", "NW", "stand", True))
        self.assertEqual(naming.parse_trade_spot("Spot_Lake_W_jetty"), ("Lake", "W", "jetty", False))
        self.assertEqual(naming.parse_trade_spot("Spot_Forest_E_conifer3"), ("Forest", "E", "conifer3", False))
        self.assertEqual(naming.parse_trade_part("Town_Tile_plaza"), ("Town", "Tile", "plaza", None, "drape"))
        self.assertIsNone(naming.parse_trade_part("LakeTown_Tile_plaza"))
        self.assertEqual(
            naming.parse_trade_river_spot("RiverSpot_Forest_NE_SW_stand"), ("Forest", "NE_SW", "stand", False)
        )
        self.assertEqual(
            naming.parse_trade_river_spot("RiverSpot_Fields_E_W_A_farmstead_alt"),
            ("Fields", "E_W_A", "farmstead", True),
        )
        self.assertIsNone(naming.parse_trade_river_spot("RiverSpot_Forest_E_E_stand"))
        for shape in naming.TRADE_RIVER_SHAPES:
            self.assertIn(f"River_Pasture_{shape}", naming.TERRAIN_TO_RESOURCE)

    def test_trade_layout_covers_every_direction(self):
        import math
        self.assertEqual(set(naming.TRADE_LAYOUT), set(naming.TRADE_DIR_ANGLE))
        for d, (fam, rot, mirror) in naming.TRADE_LAYOUT.items():
            a = naming.TRADE_DIR_ANGLE[fam] + rot
            x, y = math.cos(math.radians(a)), math.sin(math.radians(a))
            if mirror:
                x = -x
            got = round(math.degrees(math.atan2(y, x))) % 360
            self.assertEqual(got, naming.TRADE_DIR_ANGLE[d], d)
        for g in naming.TRADE_GROUNDS:
            self.assertIn(g, naming.TERRAIN_TO_RESOURCE)


if __name__ == "__main__":
    unittest.main()
