"""The fold repair's numbers, without Blender.

`river_fold` is the math half of `unfold_river_water.py` and imports no bpy.
Key properties: the detector reports no fold on a ribbon that is fine, and the
repair is a no-op on a ribbon that never folded (so re-running is safe).
"""

import math
import unittest

import river_fold


def ribbon(centres, offsets):
    """A station grid: each centre gets a rib perpendicular to the local run."""
    rows = []
    n = len(centres)
    for i, c in enumerate(centres):
        before = centres[max(i - 1, 0)]
        after = centres[min(i + 1, n - 1)]
        tx, ty = after[0] - before[0], after[1] - before[1]
        length = math.hypot(tx, ty)
        # The rib points at column 0, i.e. 90 degrees left of the run.
        ux, uy = -ty / length, tx / length
        rows.append([(c[0] + ux * o, c[1] + uy * o) for o in offsets])
    return rows


def arc(radius, sweep_deg, stations):
    """A circular arc's centreline, `sweep_deg` of it, starting due east."""
    out = []
    for k in range(stations):
        a = math.radians(sweep_deg) * k / (stations - 1)
        out.append((radius * math.sin(a), radius * (1 - math.cos(a))))
    return out


KIT = [0.300, 0.130, 0.0, -0.130, -0.300]


class GridShape(unittest.TestCase):
    def test_shipped_water_and_channel(self):
        # river_hills_ne_se as it ships: 180 verts / 140 quads of water and
        # 324 / 280 of channel. Both have exactly one odd-width reading.
        self.assertEqual(river_fold.grid_shape(180, 140), (36, 5))
        self.assertEqual(river_fold.grid_shape(324, 280), (36, 9))

    def test_headwater_not_a_grid(self):
        # river_mountains_src_e's water: a tarn, three rivulets and a reach
        # welded into one body, 205 verts and 204 faces. Not a ribbon.
        self.assertIsNone(river_fold.grid_shape(205, 204))


class Detector(unittest.TestCase):
    def test_straight_ribbon_no_overlap(self):
        rows = ribbon([(0.15 * i, 0.0) for i in range(20)], KIT)
        self.assertEqual(river_fold.overlapping_pairs(rows), [])

    def test_gentle_arc_no_overlap(self):
        # Radius 1.2 against a 0.30 bank: four times the half width, which is
        # about what the mountains sweep at.
        rows = ribbon(arc(1.2, 90, 20), KIT)
        self.assertEqual(river_fold.overlapping_pairs(rows), [])

    def test_tight_arc_folds(self):
        # Radius 0.22 against a 0.30 bank: the inside of the bend folds, as on
        # the hills tiles.
        rows = ribbon(arc(0.22, 120, 20), KIT)
        self.assertGreater(len(river_fold.overlapping_pairs(rows)), 0)

    def test_only_outer_lanes_fold(self):
        # Radius 0.20 sits between the dark lane's 0.130 and the bank's 0.300,
        # so the outer lanes fold and the middle two do not.
        rows = ribbon(arc(0.20, 120, 20), KIT)
        lanes = {lane for pair in river_fold.overlapping_pairs(rows) for _, lane in pair}
        self.assertTrue(lanes)
        self.assertEqual(lanes - {0, 3}, set())


class Repair(unittest.TestCase):
    def test_clean_ribbon_untouched(self):
        # Including one whose ribs turn faster than RIB_TURN_MAX without
        # folding (like `river_mountains_e_w_a`), which must not be rewritten.
        # 160 degrees over five stations is 40 of rib turn each, but at radius
        # 0.45 with 0.31 between stations the ribs cross at 0.43, outside the
        # 0.30 bank.
        rows = ribbon(arc(0.45, 160, 5), KIT)
        self.assertEqual(river_fold.overlapping_pairs(rows), [])
        fixed, factors, _, left = river_fold.unfold(rows)
        self.assertEqual(left, 0)
        self.assertEqual(factors, [[1.0, 1.0]] * len(rows))
        for before, after in zip(rows, fixed):
            for p, q in zip(before, after):
                self.assertAlmostEqual(p[0], q[0], places=9)
                self.assertAlmostEqual(p[1], q[1], places=9)

    def test_folded_ribbon_repaired(self):
        rows = ribbon(arc(0.22, 120, 24), KIT)
        self.assertGreater(len(river_fold.overlapping_pairs(rows)), 0)
        fixed, _, _, left = river_fold.unfold(rows)
        self.assertEqual(left, 0)
        self.assertEqual(river_fold.overlapping_pairs(fixed), [])

    def test_idempotent(self):
        # A repaired tile is a fixed point, so the driver is safe to re-run.
        once, _, _, _ = river_fold.unfold(ribbon(arc(0.22, 120, 24), KIT))
        twice, _, _, left = river_fold.unfold(once)
        self.assertEqual(left, 0)
        for a, b in zip(once, twice):
            for p, q in zip(a, b):
                self.assertAlmostEqual(p[0], q[0], places=9)
                self.assertAlmostEqual(p[1], q[1], places=9)

    def test_mouths_fixed(self):
        rows = ribbon(arc(0.22, 120, 24), KIT)
        fixed, factors, _, _ = river_fold.unfold(rows)
        self.assertEqual(factors[0], [1.0, 1.0])
        self.assertEqual(factors[-1], [1.0, 1.0])
        for i in (0, -1):
            for p, q in zip(rows[i], fixed[i]):
                self.assertAlmostEqual(p[0], q[0], places=9)
                self.assertAlmostEqual(p[1], q[1], places=9)

    def test_no_vertex_moves_outward(self):
        # The repair stays inside the corridor the original water occupied, so
        # it cannot push water out of its bed, over the chip or into the gutter.
        rows = ribbon(arc(0.22, 120, 24), KIT)
        fixed, _, _, _ = river_fold.unfold(rows)
        for before, after in zip(rows, fixed):
            centre = before[len(before) // 2]
            for p, q in zip(before, after):
                was = math.hypot(p[0] - centre[0], p[1] - centre[1])
                now = math.hypot(q[0] - centre[0], q[1] - centre[1])
                self.assertLessEqual(now, was + 1e-9)

    def test_centreline_fixed(self):
        rows = ribbon(arc(0.22, 120, 24), KIT)
        fixed, _, _, _ = river_fold.unfold(rows)
        for before, after in zip(rows, fixed):
            mid = len(before) // 2
            self.assertAlmostEqual(before[mid][0], after[mid][0], places=9)
            self.assertAlmostEqual(before[mid][1], after[mid][1], places=9)

    def test_lane_proportions_kept(self):
        # The dark thalweg stays in proportion (0.130 of 0.300) to whatever
        # bank the station ends up with.
        rows = ribbon(arc(0.22, 120, 24), KIT)
        fixed, _, _, _ = river_fold.unfold(rows)
        for row in fixed:
            centre = row[2]
            outer = math.hypot(row[0][0] - centre[0], row[0][1] - centre[1])
            inner = math.hypot(row[1][0] - centre[0], row[1][1] - centre[1])
            self.assertAlmostEqual(inner / outer, 0.130 / 0.300, places=6)

    def test_mirror_equivariant(self):
        # Every `_nw_sw` is its `_ne_se` reflected through x = 0, and
        # riverArt.test.ts holds the pair to 1e-3, so the repair must be
        # equivariant.
        rows = ribbon(arc(0.22, 120, 24), KIT)
        mirrored = [[(-x, y) for (x, y) in row] for row in rows]
        fixed, _, _, _ = river_fold.unfold(rows)
        other, _, _, _ = river_fold.unfold(mirrored)
        for a, b in zip(fixed, other):
            for p, q in zip(a, b):
                self.assertAlmostEqual(-p[0], q[0], places=9)
                self.assertAlmostEqual(p[1], q[1], places=9)


class RibFrame(unittest.TestCase):
    def test_offsets_round_trip(self):
        rows = ribbon(arc(1.2, 90, 12), KIT)
        _, _, offsets, residual = river_fold.rib_frame(rows)
        for row in offsets:
            for got, want in zip(row, KIT):
                self.assertAlmostEqual(got, want, places=9)
        for row in residual:
            for r in row:
                self.assertAlmostEqual(math.hypot(*r), 0.0, places=9)

    def test_crossing_at_radius_of_curvature(self):
        # Ribs on an arc of radius R all point at its centre, so they cross at
        # R. That identity is what `clamp_factors` is bounding against.
        # The arc turns left and column 0 is its left-hand bank, so the
        # crossing is on the plus side and the right bank never crosses at all.
        rows = ribbon(arc(0.5, 90, 16), KIT)
        centre, unit, _, _ = river_fold.rib_frame(rows)
        plus, minus = river_fold.crossing_limits(centre, unit)
        for i in range(1, len(rows) - 1):
            self.assertAlmostEqual(plus[i], 0.5, places=2)
            self.assertEqual(minus[i], -math.inf)


class SmoothRibs(unittest.TestCase):
    def test_gentle_run_untouched(self):
        angles = [math.radians(a) for a in (0, 5, 10, 15, 20)]
        self.assertEqual(river_fold.smooth_ribs(angles), angles)

    def test_corner_spread_ends_fixed(self):
        angles = [math.radians(a) for a in (0, 0, 0, 80, 80, 80, 80)]
        out = river_fold.smooth_ribs(angles)
        self.assertEqual(out[0], angles[0])
        self.assertEqual(out[-1], angles[-1])
        turns = [abs(out[i + 1] - out[i]) for i in range(len(out) - 1)]
        self.assertLess(max(turns), math.radians(river_fold.RIB_TURN_MAX) + 1e-9)

    def test_rotation_capped(self):
        angles = [math.radians(a) for a in (0, 0, 0, 0, 170, 170, 170, 170)]
        out = river_fold.smooth_ribs(angles)
        for got, was in zip(out, angles):
            self.assertLessEqual(
                abs(got - was), math.radians(river_fold.RIB_ROTATE_MAX) + 1e-9
            )


if __name__ == "__main__":
    unittest.main()
