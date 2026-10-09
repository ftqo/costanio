"""`recipes.py`: the recipe-built tiles as the hex check sees them."""

import json
import os
import tempfile
import unittest

import recipes


class Recipes(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        with open(os.path.join(self.dir, "parts.json"), "w") as h:
            json.dump({"grounds": {"lake": {"terrain": "Lake", "file": "x"}, "forest": {"terrain": "Forest", "file": "y"}}}, h)

    def write(self, name):
        with open(os.path.join(self.dir, name), "w") as h:
            h.write("{}")

    def test_terrain_names(self):
        self.assertEqual(recipes.terrain_for_key("trade_lake_nw"), "Trade_Lake_NW")
        self.assertEqual(recipes.terrain_for_key("river_forest_e_w_a"), "River_Forest_E_W_A")
        self.assertEqual(recipes.terrain_for_key("river_fields_src_ne"), "River_Fields_Src_NE")

    def test_recipe_fields(self):
        self.write("trade_lake_w.json")
        self.write("river_forest_ne_sw.json")
        got = recipes.recipes(self.dir)
        self.assertEqual([r["key"] for r in got], ["river_forest_ne_sw", "trade_lake_w"])
        self.assertEqual(got[1]["terrain"], "Trade_Lake_W")
        self.assertEqual(got[1]["base"], "Lake")
        self.assertEqual(got[0]["file"], "tiles/river_forest_ne_sw.glb")

    def test_misnamed_recipe_refused(self):
        self.write("lake_town.json")
        with self.assertRaises(ValueError):
            recipes.recipes(self.dir)

    def test_unknown_ground_refused(self):
        self.write("trade_moon_w.json")
        with self.assertRaises(ValueError):
            recipes.recipes(self.dir)

    def test_committed_recipes_parse(self):
        got = recipes.recipes()
        self.assertTrue(all(r["kind"] in ("trade", "river") for r in got))
