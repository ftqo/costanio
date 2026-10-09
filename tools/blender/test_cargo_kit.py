"""The envelope the three Explorers cargo pieces have to stay inside.

`frontend/src/lib/board3d/cargoArt.test.ts` measures the shipped file. This
measures the geometry without Blender or an export, so `make test-tools` checks
edits to `cargo_kit.py`, and it asserts what `gen/cargo.py` depends on: every
mesh is a closed manifold (`recalc_face_normals` guesses on an open shell).

Run without Blender: `python3 -m unittest tools.blender.test_cargo_kit`, or
the whole bpy-free half with `make test-tools`.
"""

import os
import sys
import unittest
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cargo_kit as ck  # noqa: E402

#: The three pieces, as the union of the parts that carry each prefix.
PIECES = ("Haul_", "Spice_", "Marker_")


def piece(prefix):
    """Every part whose name starts with `prefix`, merged into one mesh."""
    return ck.merge([build() for name, build, _ in ck.PARTS if name.startswith(prefix)])


def parts():
    """`name -> (verts, faces)` for every part in the family."""
    return {name: build() for name, build, _ in ck.PARTS}


class ManifoldTest(unittest.TestCase):
    """Every part is closed; see the module docstring."""

    def test_parts_are_closed_manifolds(self):
        for name, (verts, faces) in parts().items():
            with self.subTest(name):
                edges = Counter()
                for face in faces:
                    for k in range(len(face)):
                        a, b = face[k], face[(k + 1) % len(face)]
                        edges[(min(a, b), max(a, b))] += 1
                open_edges = sorted(e for e, n in edges.items() if n != 2)
                self.assertEqual(open_edges, [], f"{name} has {len(open_edges)} unpaired edges")
                self.assertTrue(
                    all(0 <= i < len(verts) for face in faces for i in face),
                    f"{name} indexes a vertex it does not have",
                )

    def test_no_repeated_face_vertex(self):
        # `mesh.validate()` silently drops a degenerate face, which is how a
        # part loses a wall and still exports.
        for name, (_, faces) in parts().items():
            with self.subTest(name):
                for face in faces:
                    self.assertEqual(len(set(face)), len(face), f"{name}: degenerate {face}")


class EnvelopeTest(unittest.TestCase):
    """Size limits for the three pieces."""

    def test_pieces_rest_on_z_zero(self):
        # `board3d/seating.ts` solves `surface = y + scale * baseY` off the
        # art's own base, which is exactly 0.
        for prefix in PIECES:
            with self.subTest(prefix):
                lo, _ = ck.bounds(piece(prefix)[0])
                self.assertAlmostEqual(lo[2], 0.0, places=6)

    def test_haul_fits_recess(self):
        lo, hi = ck.bounds(piece("Haul_")[0])
        long, across = hi[0] - lo[0], hi[1] - lo[1]
        self.assertLess(long, ck.HOLD_RECESS[0], "longer than the recess")
        self.assertLess(across, ck.HOLD_RECESS[1], "wider than the recess")
        # Tight clearance, so drift between this and `art/vessels` shows.
        self.assertLess(ck.HOLD_RECESS[0] - long, 0.05)
        self.assertLess(ck.HOLD_RECESS[1] - across, 0.05)
        # And it is the specified size, to a hundredth.
        self.assertAlmostEqual(long, ck.HAUL_LEN, delta=0.01)
        self.assertAlmostEqual(across, ck.HAUL_WIDE, delta=0.01)

    def test_haul_half_turn_symmetric(self):
        # Two fish head to tail, so the piece has no front (a hold does not
        # say which end is the bow).
        lo, hi = ck.bounds(piece("Haul_")[0])
        self.assertAlmostEqual(lo[0] + hi[0], 0.0, places=6)
        self.assertAlmostEqual(lo[1] + hi[1], 0.0, places=6)
        # Which is made of two fish that really do face opposite ways.
        nose_a = ck.bounds(ck.haul_fish(1)[0])[1][0]
        nose_b = ck.bounds(ck.haul_fish(-1)[0])[0][0]
        self.assertGreater(nose_a, 0.0)
        self.assertLess(nose_b, 0.0)

    def test_two_sacks_side_by_side(self):
        lo, hi = ck.bounds(piece("Spice_")[0])
        wide, deep, tall = (hi[i] - lo[i] for i in range(3))
        self.assertAlmostEqual(wide, deep, places=6, msg="round in plan")
        self.assertLess(2 * wide, ck.HOLD_RECESS[0], "two along the recess")
        self.assertLess(wide, ck.HOLD_RECESS[1] / 2 + 0.055, "two across it")
        self.assertGreater(tall, wide, "a sack, not a pat")

    def test_sack_pile_leans(self):
        _, hi = ck.bounds(ck.spice_sack()[0])
        width = hi[0] * 2
        # Neighbours interpenetrate, which is what burlap does.
        self.assertLess(ck.SACK_PITCH, width)
        self.assertGreater(ck.SACK_PITCH, width * 0.8)
        # The fourth sack settles into the valley between three: above their
        # widest ring, below their cinch.
        # The widest ring, found by radius rather than by position in the
        # profile.
        belly = max(ck.SACK_PROFILE, key=lambda rz: rz[0])[1]
        neck = min(ck.SACK_PROFILE, key=lambda rz: rz[0])[1]
        self.assertGreater(ck.SACK_TIER, belly)
        self.assertLess(ck.SACK_TIER, neck + 0.01)

    def test_marker_stack_pitch(self):
        lo, hi = ck.bounds(piece("Marker_")[0])
        self.assertAlmostEqual(hi[0] - lo[0], 0.2, places=6, msg="across")
        self.assertAlmostEqual(hi[1] - lo[1], 0.2, places=6, msg="round in plan")
        self.assertAlmostEqual(hi[2] - lo[2], ck.MARKER_STACK, places=6, msg="thickness")
        # The bevel: narrower where two markers touch than at the waist, so a
        # pile shows a line between them.
        radius = lambda v: (v[0] ** 2 + v[1] ** 2) ** 0.5  # noqa: E731
        rim = ck.marker_rim()[0]
        widest = max(radius(v) for v in rim)
        for where, keep in (("underside", lambda z: z < 0.002), ("top", lambda z: z > 0.072)):
            flat = max(radius(v) for v in rim if keep(v[2]))
            self.assertGreater(widest - flat, 0.01, f"no bevel at the {where}")


class BudgetTest(unittest.TestCase):
    """Low-poly, and measurably so."""

    def test_face_budget(self):
        # Blender faces, which are quads and n-gons here; the shipped triangle
        # counts are roughly double and are pinned in `cargoArt.test.ts`. The
        # haul is 60 faces and the sack 52; the ceilings sit close above.
        for prefix, ceiling in (("Haul_", 80), ("Spice_", 70), ("Marker_", 110)):
            with self.subTest(prefix):
                self.assertLess(len(piece(prefix)[1]), ceiling)

    def test_one_material_per_part(self):
        # One material per part, so `palette.json` can restyle it and
        # `instancing.mergeParts` can merge it.
        seen = {name: material for name, _, material in ck.PARTS}
        self.assertEqual(len(seen), len(ck.PARTS), "two parts share a name")
        neutral = {m for m in seen.values() if not m.startswith("Seat_")}
        self.assertEqual(neutral, set(ck.MATERIALS), "MATERIALS and PARTS disagree")

    def test_only_marker_seat_tinted(self):
        # The same contract `loader.test.ts` pins on the shipped file, checked
        # here where `PARTS` is edited.
        for name, _, material in ck.PARTS:
            with self.subTest(name):
                self.assertEqual(
                    material.startswith("Seat_"),
                    name.startswith("Marker_"),
                    f"{name} wears {material}",
                )


if __name__ == "__main__":
    unittest.main()
