"""Tests for the served-asset metadata stripper.

Each case builds the smallest file of its container that carries both a piece
of metadata and a piece of real payload, then asserts the metadata is gone and
the payload is byte-identical (a stripper that mangles a seek table or a color
table is worse than none).
"""

import json
import struct
import unittest

import assetmeta


def make_glb(gltf, binary=b"\x01\x02\x03\x04"):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    chunks = struct.pack("<II", len(js), assetmeta.CHUNK_JSON) + js
    chunks += struct.pack("<II", len(binary), 0x004E4942) + binary
    return struct.pack("<III", assetmeta.GLB_MAGIC, 2, 12 + len(chunks)) + chunks


def glb_json(data):
    (length,) = struct.unpack("<I", data[12:16])
    return json.loads(data[20 : 20 + length].decode())


class TestGLB(unittest.TestCase):
    def setUp(self):
        self.gltf = {
            "asset": {"generator": "Khronos glTF Blender I/O v5.2.39", "version": "2.0"},
            "scenes": [{"name": "Scene", "nodes": [0]}],
            "nodes": [{"mesh": 0, "name": "Dice_d6_a", "extras": {"author": "someone"}}],
            "meshes": [{"name": "Dice_d6_a_mesh", "primitives": []}],
        }

    def test_drops_generator_and_extras(self):
        out = assetmeta.strip_glb(make_glb(self.gltf))
        gltf = glb_json(out)
        self.assertEqual(gltf["asset"], {"version": "2.0"})
        self.assertNotIn("extras", gltf["nodes"][0])

    def test_keeps_names_and_binary_chunk(self):
        out = assetmeta.strip_glb(make_glb(self.gltf, binary=b"\xde\xad\xbe\xef" * 4))
        gltf = glb_json(out)
        self.assertEqual(gltf["nodes"][0]["name"], "Dice_d6_a")
        self.assertEqual(gltf["meshes"][0]["name"], "Dice_d6_a_mesh")
        self.assertIn(b"\xde\xad\xbe\xef" * 4, out)

    def test_header_stays_consistent(self):
        out = assetmeta.strip_glb(make_glb(self.gltf))
        magic, version, total = struct.unpack("<III", out[:12])
        self.assertEqual((magic, version, total), (assetmeta.GLB_MAGIC, 2, len(out)))
        off = 12
        while off < len(out):
            (clen,) = struct.unpack("<I", out[off : off + 4])
            self.assertEqual(clen % 4, 0, "chunks stay four-byte aligned")
            off += 8 + clen

    def test_minversion_survives(self):
        self.gltf["asset"]["minVersion"] = "2.0"
        gltf = glb_json(assetmeta.strip_glb(make_glb(self.gltf)))
        self.assertEqual(gltf["asset"], {"version": "2.0", "minVersion": "2.0"})

    def test_idempotent(self):
        once = assetmeta.strip_glb(make_glb(self.gltf))
        self.assertIs(assetmeta.strip_glb(once), once)


def make_gif(*, comment=True, loop=True):
    data = bytearray(b"GIF89a")
    data += struct.pack("<HH", 2, 2) + bytes([0x80, 0, 0])  # LSD, global table flag
    data += b"\x00\x00\x00\xff\xff\xff"  # 2-entry global color table
    if loop:
        data += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    if comment:
        text = b"Animated GIF Producer, www.avlandesign.com"
        data += b"\x21\xfe" + bytes([len(text)]) + text + b"\x00"
    data += b"\x21\xf9\x04\x00\x00\x00\x00\x00"  # graphic control extension
    data += b"\x2c" + struct.pack("<HHHH", 0, 0, 2, 2) + b"\x00"  # image descriptor
    data += b"\x02\x02\x4c\x01\x00"  # LZW min code size + one sub-block
    data += b"\x3b"
    return bytes(data)


class TestGIF(unittest.TestCase):
    def test_drops_comment(self):
        out = assetmeta.strip_gif(make_gif())
        self.assertNotIn(b"avland", out)
        self.assertEqual(out, make_gif(comment=False))

    def test_keeps_loop_and_frame_data(self):
        out = assetmeta.strip_gif(make_gif())
        self.assertIn(b"NETSCAPE2.0", out)
        self.assertIn(b"\x21\xf9\x04", out, "graphic control extension survives")
        self.assertIn(b"\x02\x02\x4c\x01\x00", out, "image data survives")
        self.assertTrue(out.endswith(b"\x3b"))
        self.assertIn(b"\x00\x00\x00\xff\xff\xff", out, "color table survives")

    def test_idempotent(self):
        once = assetmeta.strip_gif(make_gif())
        self.assertIs(assetmeta.strip_gif(once), once)

    def test_clean_gif_untouched(self):
        clean = make_gif(comment=False)
        self.assertIs(assetmeta.strip_gif(clean), clean)


def png_chunk(ctype, body=b""):
    import zlib

    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))


def make_png(extra=()):
    data = assetmeta.PNG_MAGIC
    data += png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    for chunk in extra:
        data += chunk
    data += png_chunk(b"IDAT", b"\x78\x9c\x62\x00\x00\x00\x00\xff\xff")
    data += png_chunk(b"IEND")
    return data


class TestPNG(unittest.TestCase):
    def test_drops_text_and_time(self):
        dirty = make_png(
            extra=[
                png_chunk(b"tEXt", b"Software\x00Blender"),
                png_chunk(b"tIME", b"\x07\xea\x08\x08\x0c\x29\x31"),
            ]
        )
        out = assetmeta.strip_png(dirty)
        self.assertNotIn(b"Blender", out)
        self.assertNotIn(b"tIME", out)
        self.assertEqual(out, make_png())

    def test_keeps_color_management(self):
        srgb = png_chunk(b"sRGB", b"\x00")
        out = assetmeta.strip_png(make_png(extra=[srgb, png_chunk(b"tEXt", b"a\x00b")]))
        self.assertIn(srgb, out)

    def test_idempotent(self):
        clean = make_png()
        self.assertIs(assetmeta.strip_png(clean), clean)


def webp_chunk(ctype, body):
    pad = b"\x00" if len(body) % 2 else b""
    return ctype + struct.pack("<I", len(body)) + body + pad


def make_webp(*, meta=True):
    flags = 0x10 | (assetmeta.WEBP_FLAG_EXIF | assetmeta.WEBP_FLAG_XMP if meta else 0)
    body = webp_chunk(b"VP8X", bytes([flags, 0, 0, 0]) + b"\x00\x00\x00\x00\x00\x00")
    body += webp_chunk(b"VP8L", b"\x2f\x00\x00\x00\x00\x88\x88\x08")
    if meta:
        body += webp_chunk(b"EXIF", b"MM\x00\x2aBlender 5.2")
        body += webp_chunk(b"XMP ", b"<x:xmpmeta>author</x:xmpmeta>")
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + body


class TestWebP(unittest.TestCase):
    def test_drops_exif_and_xmp(self):
        out = assetmeta.strip_webp(make_webp())
        self.assertNotIn(b"Blender", out)
        self.assertNotIn(b"xmpmeta", out)
        self.assertEqual(out, make_webp(meta=False))

    def test_clears_flags_and_riff_size(self):
        out = assetmeta.strip_webp(make_webp())
        self.assertEqual(out[20] & (assetmeta.WEBP_FLAG_EXIF | assetmeta.WEBP_FLAG_XMP), 0)
        self.assertEqual(out[20] & 0x10, 0x10, "the alpha flag is untouched")
        self.assertEqual(struct.unpack("<I", out[4:8])[0], len(out) - 8)

    def test_keeps_image_data(self):
        out = assetmeta.strip_webp(make_webp())
        self.assertIn(b"\x2f\x00\x00\x00\x00\x88\x88\x08", out)

    def test_idempotent(self):
        once = assetmeta.strip_webp(make_webp())
        self.assertIs(assetmeta.strip_webp(once), once)


def make_mp3(*, id3=True, encoder=b"Lavc59.37"):
    data = b""
    if id3:
        frame = b"TSSE" + struct.pack(">I", 15) + b"\x00\x00" + b"\x03Lavf59.27.100"
        body = frame + b"\x00" * 6
        data += b"ID3\x04\x00\x00" + bytes([0, 0, 0, len(body)]) + body
    frame = bytearray(b"\xff\xfb\xb4\x00" + b"\x00" * 400)
    at = 32
    frame[at : at + 4] = b"Info"
    frame[at + 4 : at + 8] = struct.pack(">I", 0xF)
    frame[at + 8 : at + 12] = struct.pack(">I", 75)  # frame count
    frame[at + 12 : at + 16] = struct.pack(">I", 43776)  # byte count
    frame[at + 16 : at + 116] = bytes(range(100))  # seek table
    frame[at + 116 : at + 120] = struct.pack(">I", 0)  # VBR quality
    frame[at + 120 : at + 129] = encoder
    struct.pack_into(">H", frame, 190, assetmeta._lame_crc16(bytes(frame[:190])))
    return data + bytes(frame) + b"\xff\xfb\xb4\x00" + b"\x11" * 100


class TestMP3(unittest.TestCase):
    def test_drops_id3v2(self):
        out = assetmeta.strip_mp3(make_mp3())
        self.assertFalse(out.startswith(b"ID3"))
        self.assertNotIn(b"Lavf59.27.100", out)
        self.assertTrue(out.startswith(b"\xff\xfb"), "the first audio frame is now first")

    def test_drops_id3v1(self):
        tagged = make_mp3(id3=False) + b"TAG" + b"\x00" * 125
        out = assetmeta.strip_mp3(tagged)
        self.assertEqual(out, assetmeta.strip_mp3(make_mp3(id3=False)))

    def test_blanks_xing_encoder(self):
        out = assetmeta.strip_mp3(make_mp3())
        self.assertNotIn(b"Lavc", out)
        at = out.find(b"Info")
        self.assertEqual(out[at + 120 : at + 129], b"\x00" * 9)

    def test_keeps_seek_table_and_audio(self):
        out = assetmeta.strip_mp3(make_mp3())
        at = out.find(b"Info")
        self.assertEqual(struct.unpack(">I", out[at + 8 : at + 12])[0], 75)
        self.assertEqual(out[at + 16 : at + 116], bytes(range(100)))
        self.assertTrue(out.endswith(b"\x11" * 100), "audio frames after the header survive")

    def test_repairs_lame_checksum(self):
        out = assetmeta.strip_mp3(make_mp3())
        frame = out[:190]
        self.assertEqual(struct.unpack(">H", out[190:192])[0], assetmeta._lame_crc16(frame))

    def test_idempotent(self):
        once = assetmeta.strip_mp3(make_mp3())
        self.assertIs(assetmeta.strip_mp3(once), once)


def jpeg_seg(marker, body):
    return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body


def exif(orientation):
    ifd = struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0) + b"\x00" * 4
    return b"Exif\x00\x00" + b"II*\x00" + struct.pack("<I", 8) + ifd


SCAN = jpeg_seg(0xDA, b"\x01\x01\x00\x00\x3f\x00") + b"\x12\x34\xff\x00\x56" + b"\xff\xd9"


def make_jpeg(*segments):
    jfif = jpeg_seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    return b"\xff\xd8" + jfif + b"".join(segments) + SCAN


class TestJPEG(unittest.TestCase):
    def test_drops_exif_xmp_iptc_and_comments(self):
        dirty = make_jpeg(
            jpeg_seg(0xE1, exif(1) + b"/home/someone/scene.blend"),
            jpeg_seg(0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>"),
            jpeg_seg(0xED, b"Photoshop 3.0\x00"),
            jpeg_seg(0xFE, b"made by someone"),
        )
        out = assetmeta.strip_jpeg(dirty)
        self.assertEqual(out, make_jpeg())
        self.assertNotIn(b"/home/someone", out)

    def test_keeps_icc_and_adobe(self):
        icc = jpeg_seg(0xE2, b"ICC_PROFILE\x00\x01\x01data")
        adobe = jpeg_seg(0xEE, b"Adobe\x00\x64\x00\x00\x00\x00\x01")
        out = assetmeta.strip_jpeg(make_jpeg(icc, adobe, jpeg_seg(0xFE, b"x")))
        self.assertEqual(out, make_jpeg(icc, adobe))

    def test_keeps_orientation_exif(self):
        rotated = make_jpeg(jpeg_seg(0xE1, exif(6)))
        self.assertIs(assetmeta.strip_jpeg(rotated), rotated)

    def test_scan_data_is_verbatim(self):
        out = assetmeta.strip_jpeg(make_jpeg(jpeg_seg(0xFE, b"x")))
        self.assertTrue(out.endswith(SCAN))

    def test_idempotent(self):
        clean = make_jpeg()
        self.assertIs(assetmeta.strip_jpeg(clean), clean)


class TestDispatch(unittest.TestCase):
    def test_unknown_extension_is_untouched(self):
        data = b"anything at all"
        self.assertIs(assetmeta.strip_file_bytes("palette.json", data), data)

    def test_dispatches_on_extension(self):
        out = assetmeta.strip_file_bytes("/tmp/x/decoration.gif", make_gif())
        self.assertNotIn(b"avland", out)


if __name__ == "__main__":
    unittest.main()
