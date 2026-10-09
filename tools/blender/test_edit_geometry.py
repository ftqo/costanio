import math
import unittest

import edit_geometry as eg


class TestPolarConversions(unittest.TestCase):
    def test_polar_to_xy_and_back(self):
        x, y = eg.polar_to_xy(3.0, 90)
        self.assertAlmostEqual(x, 0.0, places=9)
        self.assertAlmostEqual(y, 3.0, places=9)
        self.assertAlmostEqual(eg.angle_deg(x, y), 90.0)

    def test_angle_deg_normalises_to_0_360(self):
        self.assertAlmostEqual(eg.angle_deg(1.0, -0.0001) % 360, 359.99, places=1)
        self.assertGreaterEqual(eg.angle_deg(-1, -1), 0.0)


class TestConstraintPoints(unittest.TestCase):
    def test_twelve_points(self):
        self.assertEqual(len(eg.CONSTRAINT_POINTS), 12)

    def test_vertices_sit_at_hex_circumradius(self):
        # The 6 points at angle 30/90/.../330, at the lattice circumradius,
        # where a settlement stands. See the ring comment in edit_geometry.py.
        for x, y in eg.CONSTRAINT_POINTS:
            r = math.hypot(x, y)
            self.assertTrue(
                math.isclose(r, anchors_hex(), rel_tol=1e-6)
                or math.isclose(r, anchors_apothem(), rel_tol=1e-6),
                f"unexpected radius {r}",
            )

    def test_nearest_constraint_at_origin(self):
        # The edge midpoints (radius = apothem) are closer to centre than
        # the vertices, so they're the binding constraint.
        self.assertAlmostEqual(eg.nearest_constraint_distance(0, 0), anchors_apothem())

    def test_nearest_constraint_on_point(self):
        x, y = eg.CONSTRAINT_POINTS[0]
        self.assertAlmostEqual(eg.nearest_constraint_distance(x, y), 0.0, places=9)

    def test_clears_constraints(self):
        # Dead centre is `apothem` from the nearest constraint.
        self.assertTrue(eg.clears_constraints([(0, 0)], margin=2.0))
        self.assertFalse(eg.clears_constraints([(0, 0)], margin=3.0))

    def test_north_and_south_points_are_vertices(self):
        # (0, 3) and (0, -3) are the hex's "points".
        n = round(anchors_hex(), 6)
        self.assertIn((0.0, n), [(round(x, 6), round(y, 6)) for x, y in eg.CONSTRAINT_POINTS])
        self.assertIn((0.0, -n), [(round(x, 6), round(y, 6)) for x, y in eg.CONSTRAINT_POINTS])


def anchors_hex():
    import lattice

    return lattice.LATTICE_SIZE


def anchors_apothem():
    import lattice

    return lattice.LATTICE_APOTHEM


class TestSmoothstep(unittest.TestCase):
    def test_endpoints(self):
        self.assertEqual(eg.smoothstep(0.0), 0.0)
        self.assertEqual(eg.smoothstep(1.0), 1.0)

    def test_clamped_outside_0_1(self):
        self.assertEqual(eg.smoothstep(-5.0), 0.0)
        self.assertEqual(eg.smoothstep(5.0), 1.0)

    def test_monotonic(self):
        xs = [i / 20.0 for i in range(21)]
        ys = [eg.smoothstep(x) for x in xs]
        self.assertEqual(ys, sorted(ys))


class TestGroundCap(unittest.TestCase):
    def test_fully_flat_inside_inner(self):
        self.assertEqual(eg.ground_cap(0.0, inner=1.0, outer=1.3, target=0.26, ceiling=0.45), 0.26)
        self.assertEqual(eg.ground_cap(1.0, inner=1.0, outer=1.3, target=0.26, ceiling=0.45), 0.26)

    def test_unrestricted_beyond_outer(self):
        cap = eg.ground_cap(1.3, inner=1.0, outer=1.3, target=0.26, ceiling=0.45)
        self.assertEqual(cap, math.inf)
        self.assertEqual(eg.ground_cap(5.0, inner=1.0, outer=1.3, target=0.26, ceiling=0.45), math.inf)

    def test_relaxes_smoothly_in_the_blend_band(self):
        cap = eg.ground_cap(1.15, inner=1.0, outer=1.3, target=0.26, ceiling=0.45)
        self.assertGreater(cap, 0.26)
        self.assertLess(cap, 0.45)

    def test_ceiling_reached_only_at_outer(self):
        # Just shy of outer, the cap is still a hair under ceiling
        # (smoothstep(t) < 1 for t < 1), so there is no hard edge.
        cap = eg.ground_cap(1.299, inner=1.0, outer=1.3, target=0.26, ceiling=0.45)
        self.assertLess(cap, 0.45)


class TestCappedHeight(unittest.TestCase):
    KW = dict(inner=1.0, outer=1.3, target=0.26, ceiling=0.45)

    def test_lowers_a_peak_inside_inner(self):
        self.assertEqual(eg.capped_height(0.398, 0.98, **self.KW), 0.26)

    def test_never_raises(self):
        # A vertex already below the target inside `inner` stays put.
        self.assertEqual(eg.capped_height(0.1, 0.5, **self.KW), 0.1)

    def test_untouched_beyond_outer(self):
        self.assertEqual(eg.capped_height(0.408, 1.4, **self.KW), 0.408)

    def test_idempotent(self):
        for orig_z, r in [(0.398, 0.98), (0.408, 1.15), (0.1, 0.3), (0.408, 1.4), (0.32, 1.0)]:
            once = eg.capped_height(orig_z, r, **self.KW)
            twice = eg.capped_height(once, r, **self.KW)
            self.assertEqual(once, twice, f"not idempotent at orig_z={orig_z} r={r}")


class TestMaxClearingScale(unittest.TestCase):
    def test_shrinks_point_past_margin(self):
        # (0, 2.9) is 0.1 from the (0, 3) vertex, inside a 0.3 margin, so even
        # cap=1.0 needs to back off.
        s = eg.max_clearing_scale([(0.0, 2.9)], margin=0.3, cap=1.0)
        self.assertIsNotNone(s)
        self.assertLess(s, 1.0)
        self.assertTrue(eg.clears_constraints([(0.0, 2.9 * s)], margin=0.3))

    def test_grows_point_well_clear(self):
        # (0, 1.5) starts well inside every constraint, so raising cap should
        # grow it, and the boundary it finds sits below the cap.
        s = eg.max_clearing_scale([(0.0, 1.5)], margin=0.3, cap=2.0)
        self.assertIsNotNone(s)
        self.assertGreater(s, 1.0)
        self.assertLess(s, 2.0)
        self.assertTrue(eg.clears_constraints([(0.0, 1.5 * s)], margin=0.3))
        # 0.3 short of the north vertex, which is now at the lattice radius.
        self.assertAlmostEqual(1.5 * s, anchors_hex() - 0.3, delta=0.01)  # step=0.005

    def test_higher_cap_never_shrinks(self):
        low = eg.max_clearing_scale([(0.0, 1.0)], margin=0.3, cap=1.2)
        high = eg.max_clearing_scale([(0.0, 1.0)], margin=0.3, cap=3.0)
        self.assertGreaterEqual(high, low)

    def test_never_exceeds_cap(self):
        s = eg.max_clearing_scale([(0.0, 0.1)], margin=0.3, cap=1.2)
        self.assertLessEqual(s, 1.2)


class TestLargestGap(unittest.TestCase):
    def test_single_gap(self):
        # Everything clustered near 0, one big empty arc from 40 to 320.
        start, end, size = eg.largest_gap([0, 10, 20, 30, 40])
        self.assertAlmostEqual(start, 40)
        self.assertAlmostEqual(end, 0)  # wraps back to the first angle, 360 mod 360
        self.assertAlmostEqual(size, 320)

    def test_wraps_past_360(self):
        # Angles bracketing 0: the gap is in the middle (90 to 270), not the
        # wraparound arc.
        start, end, size = eg.largest_gap([350, 10, 90, 270])
        self.assertAlmostEqual(start, 90)
        self.assertAlmostEqual(end, 270)
        self.assertAlmostEqual(size, 180)

    def test_matches_forest_conifers_measured_angles(self):
        # Clump centroid angles measured off Forest_conifers: the biggest gap
        # straddles 90 degrees, the bare north point.
        angles = [9.7, 38.4, 145.6, 226.9, 261.9, 295.8, 327, 340.5]
        start, end, size = eg.largest_gap(angles)
        self.assertAlmostEqual(start, 38.4)
        self.assertAlmostEqual(end, 145.6)
        self.assertGreater(size, 100)
        self.assertLess(start, 90)
        self.assertGreater(end, 90)


class TestDoorways(unittest.TestCase):
    # A wall face running due east, with the building to the north of it.
    A = (0.0, 0.0)
    B = (1.0, 0.0)
    INTERIOR = (0.5, 0.5)

    def test_face_frame_normal_points_out(self):
        u, n = eg.face_frame(self.A, self.B, self.INTERIOR)
        self.assertAlmostEqual(u[0], 1.0)
        self.assertAlmostEqual(u[1], 0.0)
        self.assertAlmostEqual(n[0], 0.0)
        self.assertAlmostEqual(n[1], -1.0)

    def test_face_frame_ignores_winding(self):
        # Same wall, given b -> a. u flips; n must not, or the door turns inward.
        _, forward = eg.face_frame(self.A, self.B, self.INTERIOR)
        _, backward = eg.face_frame(self.B, self.A, self.INTERIOR)
        self.assertAlmostEqual(forward[0], backward[0])
        self.assertAlmostEqual(forward[1], backward[1])

    def test_face_frame_rejects_degenerate(self):
        with self.assertRaises(ValueError):
            eg.face_frame(self.A, self.A, self.INTERIOR)

    def test_project_on_face(self):
        u, _ = eg.face_frame(self.A, self.B, self.INTERIOR)
        self.assertAlmostEqual(eg.project_on_face(self.A, u, (0.3, -0.9)), 0.3)

    def test_doorway_corners_straddle_wall(self):
        c = eg.doorway_corners(self.A, self.B, self.INTERIOR, 0.4, 0.2, 0.01, 0.02)
        self.assertEqual(len(c), 4)
        for us in (-1, 1):
            for ns in (-1, 1):
                x, y = c[(us, ns)]
                self.assertAlmostEqual(x, 0.4 + us * 0.1)
                # +n is outside the wall (south of it), -n is buried in it.
                self.assertAlmostEqual(y, -0.01 if ns > 0 else 0.02)

    def test_doorway_corners_size(self):
        c = eg.doorway_corners(self.A, self.B, self.INTERIOR, 0.5, 0.15, 0.012, 0.02)
        width = math.dist(c[(-1, 1)], c[(1, 1)])
        depth = math.dist(c[(1, -1)], c[(1, 1)])
        self.assertAlmostEqual(width, 0.15)
        self.assertAlmostEqual(depth, 0.032)

    def test_doorway_corners_rotated_face(self):
        # The pieces are authored at a 30 degree staging angle, so every real
        # call is on a face like this one.
        ang = math.radians(30)
        b = (math.cos(ang), math.sin(ang))
        interior = (-math.sin(ang), math.cos(ang))  # 90 degrees to port
        c = eg.doorway_corners((0.0, 0.0), b, interior, 0.5, 0.15, 0.012, 0.02)
        width = math.dist(c[(-1, 1)], c[(1, 1)])
        self.assertAlmostEqual(width, 0.15)
        # The outer pair really is on the far side of the wall from the inside.
        for us in (-1, 1):
            out = c[(us, 1)]
            inn = c[(us, -1)]
            self.assertGreater(math.dist(out, interior), math.dist(inn, interior))

    def test_doorway_corners_idempotent(self):
        # Idempotent: re-deriving from the same wall and centre reproduces the
        # panel exactly.
        args = (self.A, self.B, self.INTERIOR, 0.42, 0.15, 0.012, 0.02)
        first = eg.doorway_corners(*args)
        centre_x = sum(p[0] for p in first.values()) / 4.0
        self.assertAlmostEqual(centre_x, 0.42)
        self.assertEqual(first, eg.doorway_corners(*args))

    def test_doorway_corners_reject_bad_args(self):
        with self.assertRaises(ValueError):
            eg.doorway_corners(self.A, self.B, self.INTERIOR, 0.5, 0.0, 0.01, 0.02)
        with self.assertRaises(ValueError):
            eg.doorway_corners(self.A, self.B, self.INTERIOR, 0.5, 0.1, 0.01, -0.01)


class TestRemapMaterialSlots(unittest.TestCase):
    #: The knight, as it is authored: four slots, and the basic knight never
    #: points a face at the crest.
    SLOTS = ["Mat_Knight_steel", "Mat_Knight_shield", "Mat_Knight_crest", "Mat_Knight_base"]
    FACES = [0, 0, 1, 3, 3, 0]
    MAPPING = {
        "Mat_Knight_steel": "Seat_Body",
        "Mat_Knight_base": "Seat_Shade",
        "Mat_Knight_shield": "Seat_Detail",
    }

    def test_renames_and_drops_unused_slot(self):
        slots, faces = eg.remap_material_slots(self.SLOTS, self.FACES, self.MAPPING)
        self.assertEqual(slots, ["Seat_Body", "Seat_Detail", "Seat_Shade"])
        self.assertEqual(faces, [0, 0, 1, 2, 2, 0])

    def test_unmapped_names_kept(self):
        slots, faces = eg.remap_material_slots(
            ["Mat_Knight_steel", "Mat_Knight_crest"], [0, 1], self.MAPPING
        )
        self.assertEqual(slots, ["Seat_Body", "Mat_Knight_crest"])
        self.assertEqual(faces, [0, 1])

    def test_two_sources_merge(self):
        slots, faces = eg.remap_material_slots(
            ["a", "b", "c"], [0, 1, 2], {"a": "Seat_Detail", "c": "Seat_Detail"}
        )
        self.assertEqual(slots, ["Seat_Detail", "b"])
        self.assertEqual(faces, [0, 1, 0])

    def test_idempotent(self):
        once = eg.remap_material_slots(self.SLOTS, self.FACES, self.MAPPING)
        self.assertEqual(eg.remap_material_slots(*once, self.MAPPING), once)

    def test_rejects_chained_mapping(self):
        with self.assertRaises(ValueError):
            eg.remap_material_slots(["a", "b"], [0, 1], {"a": "b", "b": "c"})

    def test_rejects_out_of_range_face(self):
        with self.assertRaises(IndexError):
            eg.remap_material_slots(["a"], [0, 1], {})


class TestSwordLength(unittest.TestCase):
    """The blade is the input; the hand is what gets solved for.

    The blade length is chosen; the grip height follows from it.
    """

    def test_blade_reach_inverse(self):
        for girth in (1.0, 1.1, 1.2):
            reach = eg.sword_reach_for_blade(0.30, girth)
            self.assertAlmostEqual(eg.sword_blade_length(reach, girth), 0.30, places=12)

    def test_reach_formula(self):
        # The grip's own hardware is not counted as blade.
        p = eg.sword_parts(1.0)
        self.assertAlmostEqual(
            eg.sword_reach_for_blade(0.275), 0.275 + p["guard_h"] + p["handle"] / 2.0, places=12
        )

    def test_grip_z_for_lean(self):
        reach = 0.337
        grip = eg.sword_grip_z(reach, 168.0, 0.050)
        # Turned 168 degrees off vertical the point sits cos(12) * reach below
        # the hand, and that has to land exactly on the clearance asked for.
        self.assertAlmostEqual(grip - reach * math.cos(math.radians(12.0)), 0.050, places=9)

    def test_longer_sword_higher_grip(self):
        low = eg.sword_grip_z(0.30, 168.0, 0.050)
        high = eg.sword_grip_z(0.47, 168.0, 0.050)
        self.assertGreater(high, low)
        # And the hand rises by nearly the whole of the extra length.
        self.assertGreater(high - low, 0.9 * (0.47 - 0.30))

    def test_more_lean_lower_grip(self):
        # Leaning the blade out lowers the hand but swings the point further
        # outboard, over the neighbouring tile's art.
        near, far = 168.0, 150.0
        self.assertLess(eg.sword_grip_z(0.40, far, 0.05), eg.sword_grip_z(0.40, near, 0.05))
        out_near, _ = eg.sword_rest_tip(-0.3, 0.4, 0.40, near)
        out_far, _ = eg.sword_rest_tip(-0.3, 0.4, 0.40, far)
        self.assertLess(out_far, out_near)

    def test_rest_tip_matches_solve(self):
        reach, tilt, clear = 0.4719, 168.0, 0.050
        grip_z = eg.sword_grip_z(reach, tilt, clear)
        x, z = eg.sword_rest_tip(-0.405, grip_z, reach, tilt)
        self.assertAlmostEqual(z, clear, places=9)
        # Outward, away from the body, far enough that the lean is kept small.
        self.assertLess(x, -0.405)

    def test_rejects_upward_rest(self):
        for tilt in (0.0, 90.0, 60.0):
            with self.assertRaises(ValueError):
                eg.sword_grip_z(0.35, tilt, 0.012)

    def test_rejects_zero_length(self):
        with self.assertRaises(ValueError):
            eg.sword_grip_z(0.0, 168.0, 0.012)
        with self.assertRaises(ValueError):
            eg.sword_reach_for_blade(0.0)

    def test_reach_can_exceed_grip(self):
        # At `BLADE_FRACTION` 1.0 the reach exceeds the grip height, so a plumb
        # rest is unsolvable and a lean is required.
        for height, girth in ((0.55, 1.0), (0.68, 1.1), (0.795, 1.2)):
            reach = eg.sword_reach_for_blade(height, girth)
            self.assertGreater(reach, height)
            # |cos| is bounded by the hand's height over the reach, which caps
            # how near vertical the blade can rest.
            self.assertLess((height - 0.02) / reach, 1.0)

    def test_clearance_does_not_move_tip_x(self):
        # How far out the point swings depends on the lean alone; the clearance
        # only moves the hand. Less clearance allows a higher hand and a steeper
        # lean, so the least sprawl has the point on the ground.
        reach, tilt = 0.8808, 124.0
        low = eg.sword_grip_z(reach, tilt, 0.020)
        high = eg.sword_grip_z(reach, tilt, 0.080)
        self.assertGreater(high, low)
        out_low, _ = eg.sword_rest_tip(-0.4086, low, reach, tilt)
        out_high, _ = eg.sword_rest_tip(-0.4086, high, reach, tilt)
        self.assertAlmostEqual(out_low, out_high, places=12)

    def test_hilt_inboard(self):
        # `sword_grip_x_limit` is a max over the whole hilt: far off vertical
        # the pommel, not the guard, is innermost (at 124 degrees, by a factor
        # of six).
        p = eg.sword_parts(1.0)
        guard_only = p["guard_w"] / 2.0 * math.cos(math.radians(180.0 - 124.0))
        self.assertGreater(eg.sword_hilt_inboard(124.0), guard_only)
        # Near plumb the guard is innermost, within a percent of its half-width
        # (not exactly, since the guard sits above the grip).
        self.assertLess(eg.sword_hilt_inboard(179.0), p["guard_w"] / 2.0)
        self.assertGreater(eg.sword_hilt_inboard(179.0), 0.99 * p["guard_w"] / 2.0)
        # Linear in girth, since every part of the hilt is.
        self.assertAlmostEqual(
            eg.sword_hilt_inboard(124.0, 1.2), 1.2 * eg.sword_hilt_inboard(124.0), places=12
        )
        # And it refuses a rest that does not point down, like every other solve
        # here: an upright sword has no inboard hilt to clear.
        with self.assertRaises(ValueError):
            eg.sword_hilt_inboard(80.0)

    def test_grip_x_limit(self):
        # A wide crossguard held at shoulder height is long enough to bury its
        # inboard end in the chest, so the arm has to reach past the torso.
        limit = eg.sword_grip_x_limit(-0.302, 168.0, 1.2)
        self.assertLess(limit, -0.302)
        # A fatter sword needs a longer arm, and a bigger lean needs less of one
        # (until the pommel takes over; see above).
        self.assertLess(
            eg.sword_grip_x_limit(-0.302, 168.0, 1.3), eg.sword_grip_x_limit(-0.302, 168.0, 1.0)
        )
        self.assertGreater(
            eg.sword_grip_x_limit(-0.302, 150.0, 1.2), eg.sword_grip_x_limit(-0.302, 168.0, 1.2)
        )


class TestSwordMesh(unittest.TestCase):
    def test_tip_at_reach(self):
        verts, _ = eg.sword_mesh(0.25)
        self.assertAlmostEqual(max(v[2] for v in verts), 0.25, places=9)
        self.assertEqual(sum(1 for v in verts if abs(v[2] - 0.25) < 1e-9), 1)

    def test_grip_straddles_origin(self):
        # The origin is the middle of the handle, because that is what the hand
        # closes on and what the raise turns about. So there is geometry both
        # above and below z = 0.
        verts, _ = eg.sword_mesh(0.25)
        self.assertLess(min(v[2] for v in verts), 0.0)
        self.assertGreater(max(v[2] for v in verts), 0.0)

    def test_girth_widens_without_lengthening(self):
        thin, _ = eg.sword_mesh(0.25, 1.0)
        fat, _ = eg.sword_mesh(0.25, 1.3)
        self.assertAlmostEqual(max(v[2] for v in thin), max(v[2] for v in fat), places=9)
        self.assertGreater(max(v[0] for v in fat), max(v[0] for v in thin))

    def test_crossguard_proportions(self):
        # The crossguard distinguishes a sword from a stick at drawn size, so it
        # must be wide.
        p = eg.sword_parts(1.0)
        self.assertGreater(p["guard_w"], 2.0 * p["blade_w"])
        # And it is the widest thing on the sword, so the silhouette reads as a
        # cross rather than as a taper with a bump in it.
        self.assertEqual(p["guard_w"], max(p["guard_w"], p["pommel_w"], p["blade_w"], p["handle_w"]))
        # Square in plan, not a bar, so it never goes edge-on as the board
        # orbits.
        self.assertEqual(p["guard_d"], p["guard_w"])

    def test_guard_matches_reach(self):
        # The mesh and the length solve share `sword_parts`, so this holds.
        reach, girth = 0.42, 1.1
        verts, _ = eg.sword_mesh(reach, girth)
        p = eg.sword_parts(girth)
        guard_top = p["handle"] / 2.0 + p["guard_h"]
        self.assertAlmostEqual(reach - guard_top, eg.sword_blade_length(reach, girth), places=12)
        # And the widest points of the whole sword sit exactly at the guard.
        widest = max(abs(v[0]) for v in verts)
        for v in verts:
            if abs(abs(v[0]) - widest) < 1e-12:
                self.assertLessEqual(v[2], guard_top + 1e-12)

    def test_blade_wider_than_thick(self):
        # The raise sweeps the sword through the x-z plane, so the flat of the
        # blade faces the camera throughout.
        verts, _ = eg.sword_mesh(0.25)
        blade = [v for v in verts if v[2] > 0.1]
        self.assertGreater(max(v[0] for v in blade), max(v[1] for v in blade))

    def test_deterministic(self):
        self.assertEqual(eg.sword_mesh(0.25, 1.12), eg.sword_mesh(0.25, 1.12))

    def test_faces_index_valid_vertices(self):
        verts, faces = eg.sword_mesh(0.3, 1.1)
        for face in faces:
            self.assertIn(len(face), (3, 4))
            for i in face:
                self.assertTrue(0 <= i < len(verts))
        # Every vertex is used, so no orphan points ship inside the piece.
        self.assertEqual(len({i for f in faces for i in f}), len(verts))

    def test_rejects_reach_without_blade(self):
        with self.assertRaises(ValueError):
            eg.sword_mesh(0.01)


if __name__ == "__main__":
    unittest.main()
