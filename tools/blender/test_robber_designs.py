"""The envelope every robber design has to stay inside.

Each design must be about the size of the base robber: its footprint,
height band and visual weight are checked here, so `make test-tools` fails on
an edit that drifts out of range.

Run without Blender: `python3 -m unittest tools.blender.test_robber_designs`,
or the whole bpy-free half with `make test-tools`.
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import chroma as ch  # noqa: E402
import robber_designs as rd  # noqa: E402
import robber_kit as kit  # noqa: E402


class EnvelopeTest(unittest.TestCase):
    """Every design against the shipped robber's own measurements."""

    @classmethod
    def setUpClass(cls):
        cls.meshes = {name: rd.whole(name) for name in ["classic"] + rd.ORDER}
        cls.base_area = kit.silhouette_area(cls.meshes["classic"][0])

    def each(self):
        """Every design, as a list.

        Not a generator wrapping `subTest`: a failing subTest closes the
        generator and hides the remaining designs. Each test opens its own.
        """
        return [(name, self.meshes[name][0]) for name in rd.ORDER]

    def test_twenty_designs(self):
        """The set has twenty designs."""
        self.assertEqual(len(rd.ORDER), 20)
        self.assertEqual(len(set(rd.ORDER)), 20)
        self.assertNotIn("classic", rd.ORDER, "the base robber is not one of the twenty")

    def test_stands_on_the_board(self):
        """Contact point at z=0, centred on the axis it is placed at.

        `planRobber` puts the piece at the tile centre and `seating` drops it
        onto the surface, so a design whose mesh does not start at z=0 either
        floats or sinks by exactly its own error.
        """
        for name, verts in self.each():
            with self.subTest(design=name):
              (x0, x1), (y0, y1), (z0, _) = kit.bounds(verts)
              self.assertAlmostEqual(z0, 0.0, places=6, msg=f"{name} does not sit on z=0")
              self.assertLess(abs(x0 + x1) / 2.0, 0.16, f"{name} is off-axis in x")
              self.assertLess(abs(y0 + y1) / 2.0, 0.16, f"{name} is off-axis in y")

    def test_height_band(self):
        """Within a quarter of the base robber's 1.5, either way.

        The band is wide enough for a squat piece (the keg, the bear) and
        narrow enough that nothing in the set towers over the number chips.
        """
        for name, verts in self.each():
            with self.subTest(design=name):
              h = kit.height(verts)
              self.assertGreaterEqual(h, 1.15, f"{name} is only {h:.2f} tall")
              self.assertLessEqual(h, 1.60, f"{name} is {h:.2f} tall")

    def test_footprint(self):
        """Inside the base robber's radius, and planted on a wide enough foot.

        The radius cap is a clearance constraint, not taste: the piece stands
        on a number chip of radius 1.0 at `ROBBER_SCALE` 1.5, and one that
        spreads past 0.52 starts to hang over the chip's edge.
        """
        for name, verts in self.each():
            with self.subTest(design=name):
              r = kit.max_radius(verts)
              self.assertLessEqual(r, 0.52, f"{name} spreads to r={r:.2f}")
              foot = kit.footprint_radius(verts)
              self.assertGreaterEqual(foot, 0.24, f"{name}: foot {foot:.2f}, want >= 0.24")

    def test_visual_weight(self):
        """Roughly as much piece as the base one, seen from the side.

        Height alone does not say this -- a 1.5-tall needle and a 1.5-tall
        barrel are not the same object on a board -- so the band is on the
        front-view silhouette area, which is what the camera actually shows.
        """
        for name, verts in self.each():
            with self.subTest(design=name):
              area = kit.silhouette_area(verts)
              ratio = area / self.base_area
              self.assertGreater(ratio, 0.55, f"{name} is {ratio:.2f}x the base robber's mass: too slight")
              self.assertLess(ratio, 1.85, f"{name} is {ratio:.2f}x the base robber's mass: too heavy")

    def test_distinct_silhouettes(self):
        """No two designs are the same shape.

        Twenty robbers that a player cannot tell apart is one robber and
        nineteen mistakes. Compared on a coarse profile -- width at eight
        heights, normalised -- which is about what survives the camera.
        """
        def profile(verts):
            (_, _), (_, _), (z0, z1) = kit.bounds(verts)
            steps = 8
            widths = []
            for i in range(steps):
                lo = z0 + (z1 - z0) * i / steps
                hi = z0 + (z1 - z0) * (i + 1) / steps
                here = [math.hypot(x, y) for x, y, z in verts if lo - 1e-9 <= z <= hi + 1e-9]
                widths.append(max(here) if here else 0.0)
            return widths

        profiles = {name: profile(self.meshes[name][0]) for name in rd.ORDER}
        for i, a in enumerate(rd.ORDER):
            for b in rd.ORDER[i + 1 :]:
                with self.subTest(pair=f"{a}/{b}"):
                  dist = sum(abs(p - q) for p, q in zip(profiles[a], profiles[b]))
                  self.assertGreater(dist, 0.35, f"{a} and {b} have the same outline (L1 {dist:.2f})")

    def test_slots(self):
        """Three slots, all valid, and no design is one flat colour.

        A design that uses a single slot cannot be restyled into anything but
        a monochrome lump, which is the failure the recolour split exists to
        prevent.
        """
        for name in ["classic"] + rd.ORDER:
            with self.subTest(design=name):
                parts = rd.build(name)
                used = {p.slot for p in parts}
                self.assertTrue(used <= set(rd.SLOTS), f"{name} uses an unknown slot")
                self.assertGreaterEqual(len(used), 2, f"{name} is a single-slot piece")

    def test_facet_budget(self):
        """Cheap enough to instance. The shipped robber is 120 faces.

        Not a hard engine limit -- one robber is on the board at a time -- but
        a design that needs 2000 faces to read is a design that is relying on
        detail the camera throws away.
        """
        for name in ["classic"] + rd.ORDER:
            with self.subTest(design=name):
                _, faces = self.meshes[name]
                self.assertLess(len(faces), 700, f"{name} is {len(faces)} faces")

    def test_no_degenerate_faces(self):
        """No face repeats a vertex or points outside the mesh.

        N-gons are fine and expected -- a lathe's flat cap is one -- but a
        degenerate face is how a bad transform announces itself, and it is
        completely silent in a viewport screenshot.
        """
        for name in ["classic"] + rd.ORDER:
            with self.subTest(design=name):
                verts, faces = self.meshes[name]
                for f in faces:
                    self.assertGreaterEqual(len(f), 3, f"{name} has a {len(f)}-gon")
                    self.assertEqual(len(set(f)), len(f), f"{name} has a face with a repeated vertex")
                    ok = all(0 <= i < len(verts) for i in f)
                    self.assertTrue(ok, f"{name} has an out-of-range vertex index")


class ChromaTest(unittest.TestCase):
    """The rules a colourway has to obey to be sellable as one.

    A chroma is an upgrade bought against a design somebody already owns, so
    the failure this invites is selling a colour indistinguishable from the one
    they have. These are the three rules stated in `robber_designs.CHROMAS`.
    """

    def test_colored_designs_have_base(self):
        """The chroma a design is bought wearing.

        Without it there is no answer to "what does this look like before you
        upgrade it", and `colors()` would have nothing to fall back on for a
        chroma id that no longer exists -- which is what an entitlement written
        against a since-renamed chroma becomes.
        """
        for name, have in rd.CHROMAS.items():
            with self.subTest(design=name):
                self.assertIn(rd.BASE_CHROMA, have, f"{name} has no base chroma")
                self.assertEqual(rd.chromas(name)[0], rd.BASE_CHROMA)

    def test_chromas_fill_slots(self):
        """No partial chromas.

        A chroma missing a slot inherits the base's colour there, which reads
        as a bug rather than as a design -- a green crystal with one blue shard
        left on it looks broken, not deliberate.
        """
        for name, have in rd.CHROMAS.items():
            for cid, colors in have.items():
                with self.subTest(design=name, chroma=cid):
                    self.assertEqual(set(colors), set(rd.SLOTS), f"{name}/{cid} is partial")

    def test_chromas_distinct(self):
        """Far enough apart to be worth owning both.

        Measured on the identity slot with the same ΔE2000 and the same
        threshold the seat palette gates player colours on
        (`cosmetics.ColorThreshold`), because it is the same question: can a
        person tell these two apart at a glance, on a board, without a label.
        """
        for name in rd.CHROMAS:
            ids = rd.chromas(name)
            for i, a in enumerate(ids):
                for b in ids[i + 1:]:
                    with self.subTest(design=name, pair=f"{a}/{b}"):
                        d = ch.distance(
                            rd.colors(name, a)[rd.IDENTITY_SLOT],
                            rd.colors(name, b)[rd.IDENTITY_SLOT],
                        )
                        self.assertGreater(
                            d, ch.CHROMA_THRESHOLD,
                            f"{name}: {a} and {b} are {d:.1f} apart, under {ch.CHROMA_THRESHOLD}",
                        )

    def test_ids_parseable(self):
        """`robber.<design>` for the design, plus `.<chroma>` for an upgrade.

        The id is written into entitlements the first time anyone buys one, so
        its shape is a compatibility surface: a base chroma must NOT add a
        segment, or every design's id changes the day it gets its second
        colourway.
        """
        self.assertEqual(rd.item_id("shard"), "robber.shard")
        self.assertEqual(rd.item_id("shard", rd.BASE_CHROMA), "robber.shard")
        self.assertEqual(rd.item_id("shard", "verdant"), "robber.shard.verdant")
        for name in rd.CHROMAS:
            for cid in rd.chromas(name):
                with self.subTest(design=name, chroma=cid):
                    self.assertRegex(rd.item_id(name, cid), r"^robber\.[a-z]+(\.[a-z]+)?$")

    def test_no_palette_is_monochrome(self):
        """Designs with no palette build in the shipped near-black."""
        cut = [n for n in rd.ORDER if n not in rd.CHROMAS]
        self.assertTrue(cut)
        for name in cut:
            with self.subTest(design=name):
                self.assertEqual(rd.colors(name), rd.MONOCHROME)
                self.assertEqual(rd.chromas(name), [rd.BASE_CHROMA])


class ClassicTest(unittest.TestCase):
    """The recolourable base matches the shipped piece."""

    def test_matches_shipped_measurements(self):
        verts, _ = rd.whole("classic")
        self.assertAlmostEqual(kit.height(verts), kit.BASE_HEIGHT, places=6)
        self.assertAlmostEqual(kit.max_radius(verts), kit.BASE_RADIUS, places=6)

    def test_split_is_plinth_mass_hat(self):
        """Slots split by height: plinth low, hat high, mass between, so each
        finish can light them separately."""
        parts = {p.slot: p for p in rd.classic()}
        self.assertEqual(set(parts), set(rd.SLOTS))
        top = {slot: max(z for _, _, z in p.verts) for slot, p in parts.items()}
        bottom = {slot: min(z for _, _, z in p.verts) for slot, p in parts.items()}
        self.assertLess(top["shade"], bottom["detail"], "plinth and hat overlap in height")
        self.assertAlmostEqual(top["detail"], kit.BASE_HEIGHT, places=6)
        self.assertAlmostEqual(bottom["shade"], 0.0, places=6)


if __name__ == "__main__":
    unittest.main()
