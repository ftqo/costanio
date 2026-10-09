"""The wagon's geometry, checked without launching Blender.

`gen/wagons.py` keeps `import bpy` inside `build()`, so the dimensions and mesh
builders import plain. Run with `python3 -m unittest tools.blender.test_wagons`,
or with the rest of the bpy-free half via `make test-tools`.

Checks what is invisible until rendered:

- Winding. `prism` needs its first loop counter-clockwise seen from the
  direction the second loop is offset toward (a natural XZ ring is clockwise
  from +y, since x cross z is -y). An inside-out part renders as a hole. The
  signed volume of a closed component is positive when its faces face out.
- The base plane. The renderer seats a piece off its lowest point, which
  `wheel` puts at zero by dropping each rim.

The envelope is checked too, against the settlement it shares a junction with.
`frontend/src/lib/board3d/wagonArt.test.ts` asserts the same on the shipped
.glb.
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen"))

import wagons  # noqa: E402

#: `Settlement_A`, measured off `art/pieces.blend`: the piece a wagon parks
#: next to.
SETTLEMENT = {"long": 0.419, "wide": 0.389, "tall": 0.400}


def components(verts, faces):
    """Faces grouped by connected component, over shared vertices."""
    parent = list(range(len(verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for face in faces:
        for v in face[1:]:
            ra, rb = find(face[0]), find(v)
            if ra != rb:
                parent[ra] = rb

    groups = {}
    for face in faces:
        groups.setdefault(find(face[0]), []).append(face)
    return list(groups.values())


def signed_volume(verts, faces):
    """Six times the enclosed volume, positive when the faces face outward."""
    total = 0.0
    for face in faces:
        a = verts[face[0]]
        for k in range(1, len(face) - 1):
            b, c = verts[face[k]], verts[face[k + 1]]
            total += (
                a[0] * (b[1] * c[2] - b[2] * c[1])
                - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])
            )
    return total / 6.0


def bounds(verts):
    return [
        (min(v[i] for v in verts), max(v[i] for v in verts)) for i in range(3)
    ]


def whole():
    """Every part's geometry merged, which is the piece as it ships."""
    return wagons.merge(*[mesh for _slot, mesh in wagons.parts().values()])


class WindingTest(unittest.TestCase):
    """Every closed part faces outward. See the module docstring."""

    #: The one open surface in the piece: the back of the canopy, closed by
    #: `Wagon_tailcloth` in the darker slot. Named explicitly, so an
    #: accidentally open part still fails.
    OPEN = {"Wagon_canopy", "Wagon_tailcloth"}

    def test_closed_parts_face_outward(self):
        for name, (_slot, (verts, faces)) in wagons.parts().items():
            if name in self.OPEN:
                continue
            for i, group in enumerate(components(verts, faces)):
                with self.subTest(part=name, component=i):
                    self.assertGreater(signed_volume(verts, group), 0.0)

    def test_canopy_and_back_close(self):
        # Neither is closed alone; together they are one solid, and the pair's
        # signed volume shows they agree on which way is out.
        parts = wagons.parts()
        shell = parts["Wagon_canopy"][1]
        back = parts["Wagon_tailcloth"][1]
        self.assertGreater(signed_volume(*wagons.merge(shell, back)), 0.0)

    def test_back_faces_backward(self):
        # It is the rear cap, so it must face backward: the area-weighted
        # normal sum (non-zero because of the dish) checks that.
        verts, faces = wagons.parts()["Wagon_tailcloth"][1]
        nx = 0.0
        for face in faces:
            a, b, c = (verts[i] for i in face[:3])
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            nx += u[1] * v[2] - u[2] * v[1]
        self.assertLess(nx, 0.0)


class EnvelopeTest(unittest.TestCase):
    """Size limits."""

    def setUp(self):
        self.verts, self.faces = whole()
        self.x, self.y, self.z = bounds(self.verts)

    def test_stands_on_zero(self):
        # The base plane the renderer seats off. Produced by `wheel`, not typed.
        self.assertAlmostEqual(self.z[0], 0.0, places=9)

    def test_only_wheels_touch_ground(self):
        parts = wagons.parts()
        self.assertAlmostEqual(bounds(parts["Wagon_wheels"][1][0])[2][0], 0.0, places=9)
        for name in ("Wagon_bed", "Wagon_tongue", "Wagon_canopy"):
            with self.subTest(part=name):
                self.assertGreater(bounds(parts[name][1][0])[2][0], 0.02)

    def test_footprint_fits_junction(self):
        long, wide, tall = (hi - lo for lo, hi in (self.x, self.y, self.z))
        self.assertAlmostEqual(long, 0.551, places=3)
        self.assertAlmostEqual(wide, 0.350, places=3)
        self.assertAlmostEqual(tall, 0.450, places=3)
        # Longer and narrower than the house, so both fit on one corner, and
        # only a little taller.
        self.assertGreater(long, SETTLEMENT["long"])
        self.assertLess(wide, SETTLEMENT["wide"])
        self.assertLess(tall / SETTLEMENT["tall"], 1.3)

    def test_centred_and_forward(self):
        # Symmetric in y, asymmetric in x (it has a front, which yaw relies on).
        self.assertAlmostEqual(self.y[0] + self.y[1], 0.0, places=9)
        self.assertGreater(abs(self.x[0] + self.x[1]), 0.02)
        self.assertGreater(bounds(wagons.parts()["Wagon_tongue"][1][0])[0][0], 0.0)


class RingTest(unittest.TestCase):
    """The offsets for several wagons on one vertex. See the module docstring
    of `gen/wagons.py` for the table these hold up."""

    def setUp(self):
        self.x, self.y, _z = bounds(whole()[0])
        self.long = self.x[1] - self.x[0]
        self.wide = self.y[1] - self.y[0]

    def test_four_clear_at_0_47(self):
        self.assertLess((self.long + self.wide) / 2.0, 0.47)

    def test_three_clear_at_0_38(self):
        self.assertGreater(
            2 * 0.38 * math.sin(math.pi / 3.0), math.hypot(self.long, self.wide)
        )

    def test_two_clear_at_0_22(self):
        self.assertGreater(2 * 0.22, self.wide)


class BudgetTest(unittest.TestCase):
    """House style: 100-250 faces for a piece, three seat slots and no more."""

    def test_face_budget(self):
        total = sum(len(mesh[1]) for _slot, mesh in wagons.parts().values())
        self.assertEqual(total, 153)
        self.assertGreaterEqual(total, 100)
        self.assertLessEqual(total, 250)

    def test_parts_use_seat_slots(self):
        slots = {slot for slot, _mesh in wagons.parts().values()}
        self.assertEqual(slots, {"Seat_Body", "Seat_Shade", "Seat_Detail"})
        # And the seat colour is on the canopy, the face the board's camera
        # sees. See wagonArt.test.ts.
        self.assertEqual(wagons.parts()["Wagon_canopy"][0], "Seat_Body")

    def test_faces_index_valid_vertices(self):
        # `from_pydata` accepts an out-of-range index and `validate()` silently
        # repairs it, so check indices here.
        for name, (_slot, (verts, faces)) in wagons.parts().items():
            for face in faces:
                with self.subTest(part=name):
                    self.assertGreaterEqual(len(face), 3)
                    self.assertEqual(len(set(face)), len(face))
                    self.assertTrue(all(0 <= i < len(verts) for i in face))


if __name__ == "__main__":
    unittest.main()
