"""The trade-town parts' generated recipe (`art/trade/parts/spots.json`) against the names.

bpy-free: it reads the JSON `export_trade_parts.py` wrote, so a blend edited
without a re-export, or an export whose names drifted from `naming.py`, fails
here rather than in the composer.
"""

import json
import math
import os
import unittest

import naming

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPOTS = os.path.join(REPO, "art", "trade", "parts", "spots.json")

CHIP = (0.0, 1.5)
APOTHEM = 2.5981


def in_hex(x, y, apo=APOTHEM):
    return all(x * math.cos(math.radians(a)) + y * math.sin(math.radians(a)) <= apo for a in range(0, 360, 60))


@unittest.skipUnless(os.path.exists(SPOTS), "art/trade/parts/spots.json not exported")
class TestTradeParts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(SPOTS) as fh:
            cls.doc = json.load(fh)

    def test_part_names_follow_contract(self):
        for name, part in self.doc["parts"].items():
            parsed = naming.parse_trade_part(name)
            self.assertIsNotNone(parsed, name)
            self.assertEqual(parsed[4], part["role"], name)

    def test_layout_table_matches_naming(self):
        self.assertEqual({d: tuple(v) for d, v in self.doc["layout"].items()}, naming.TRADE_LAYOUT)

    def test_recipe_per_ground_and_direction(self):
        self.assertEqual(set(self.doc["grounds"]), set(naming.TRADE_GROUNDS))
        for g, entry in self.doc["grounds"].items():
            self.assertTrue(entry.get("yard_material", "").startswith("Mat_"), g)
            self.assertEqual(set(entry["spots"]), set(naming.TRADE_DIR_ANGLE), g)
            for d, spots in entry["spots"].items():
                for hero in spots:
                    self.assertIn(hero.removesuffix("_alt"), entry["heroes"], f"{g} {d} {hero}")

    def test_spots_stay_on_the_tile(self):
        for g, entry in self.doc["grounds"].items():
            for bucket in ("spots", "river_spots"):
                for key, spots in entry.get(bucket, {}).items():
                    for hero, s in spots.items():
                        x, y = s["blender"]
                        self.assertTrue(in_hex(x, y), f"{g} {key} {hero} at {x},{y}")
                        self.assertAlmostEqual(s["file"][1], -y, places=4)
                        self.assertGreaterEqual(s["scale"], 0.75)

    def test_moved_spots_clear_chip(self):
        # A spot is where a hero's anchor goes; the fitter keeps every vertex
        # out of the keep-clear disc, so an anchor inside it is a stale recipe.
        for g, entry in self.doc["grounds"].items():
            for d, spots in entry["spots"].items():
                for hero, s in spots.items():
                    if s["stays"]:
                        continue
                    x, y = s["blender"]
                    self.assertGreater(math.hypot(x - CHIP[0], y - CHIP[1]), 1.05, f"{g} {d} {hero}")

    def test_river_spots_for_every_shape(self):
        for g in ("Forest", "Fields"):
            rs = self.doc["grounds"][g]["river_spots"]
            self.assertEqual(set(rs), set(naming.TRADE_RIVER_SHAPES), g)
        # The forest keeps a real stand: every conifer has a spot on every shape.
        conifers = [h for h in self.doc["grounds"]["Forest"]["heroes"] if h.startswith("conifer")]
        for shape, spots in self.doc["grounds"]["Forest"]["river_spots"].items():
            for c in conifers:
                self.assertIn(c, spots, shape)


if __name__ == "__main__":
    unittest.main()
