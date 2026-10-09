"""Strip authoring metadata out of the binaries the site serves.

The tools that produce assets under frontend/public stamp themselves into the
file: the glTF exporter writes `asset.generator`, ffmpeg writes an ID3 `TSSE`
frame and an encoder string in the Xing header, GIF editors leave comment
extensions, and Blender writes the source .blend path into a PNG text chunk.
No loader reads any of it.

Stdlib only, because it runs both from `scripts/strip-asset-metadata.py` in the
dev shell and inside the Blender exporters (which call `strip_glb` on every
.glb as it is written, so a fresh export matches a stripped tree and `make
verify-split` stays meaningful). It lives here because the exporters already
have this directory on sys.path.

Not stripped:

  - Names of nodes, meshes and materials in a .glb. The loader looks assets up
    by name and palette.json is keyed on material names. They are data.
  - Color-affecting chunks (PNG gAMA/cHRM/sRGB/iCCP, WebP ICCP, JPEG APP2
    ICC profiles and the APP14 Adobe transform flag). Dropping those changes
    how the image renders. A JPEG EXIF block that carries a non-default
    orientation is kept for the same reason.
  - The fonts. They are OFL, and the license requires the copyright notice in
    the name table to travel with the file.
"""

import json
import os
import struct

# Extensions this module knows how to strip. Anything else under public/ is
# passed through untouched by the CLI.
HANDLED = (".glb", ".gif", ".mp3", ".png", ".webp", ".jpg", ".jpeg")


def strip_file_bytes(path, data):
    """Return `data` with metadata removed, dispatching on `path`'s extension.

    Returns the same bytes when there was nothing to strip or the extension is
    not one we handle, so callers can test identity to detect a no-op.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext == ".glb":
        return strip_glb(data)
    if ext == ".gif":
        return strip_gif(data)
    if ext == ".mp3":
        return strip_mp3(data)
    if ext == ".png":
        return strip_png(data)
    if ext == ".webp":
        return strip_webp(data)
    if ext in (".jpg", ".jpeg"):
        return strip_jpeg(data)
    return data


def strip_path(path):
    """Strip `path` in place. Returns True if the file changed."""
    with open(path, "rb") as fh:
        data = fh.read()
    out = strip_file_bytes(path, data)
    if out == data:
        return False
    with open(path, "wb") as fh:
        fh.write(out)
    return True


# --------------------------------------------------------------------------
# glTF binary
# --------------------------------------------------------------------------

GLB_MAGIC = 0x46546C67  # 'glTF'
CHUNK_JSON = 0x4E4F534A  # 'JSON'


def _prune_extras(node):
    """Drop every `extras` object anywhere in the glTF JSON tree.

    Blender fills `extras` from an object's custom properties. Nothing in the
    loader reads it (three.js maps it to userData, which ours only writes at
    runtime).
    """
    if isinstance(node, dict):
        node.pop("extras", None)
        for value in node.values():
            _prune_extras(value)
    elif isinstance(node, list):
        for value in node:
            _prune_extras(value)


def strip_glb(data):
    """Remove the generator stamp, copyright and extras from a .glb.

    `asset.version` and `asset.minVersion` are required and stay. Everything
    else in the asset block describes the tool, not the model.
    """
    if len(data) < 12:
        return data
    magic, _version, total = struct.unpack("<III", data[:12])
    if magic != GLB_MAGIC or total > len(data):
        return data

    chunks = []
    off = 12
    while off + 8 <= total:
        clen, ctype = struct.unpack("<II", data[off : off + 8])
        body = data[off + 8 : off + 8 + clen]
        if len(body) < clen:
            return data  # truncated; leave it alone rather than guess
        chunks.append([ctype, body])
        off += 8 + clen + (-clen % 4)

    changed = False
    for chunk in chunks:
        if chunk[0] != CHUNK_JSON:
            continue
        gltf = json.loads(chunk[1].decode("utf-8"))
        asset = gltf.get("asset", {})
        kept = {k: v for k, v in asset.items() if k in ("version", "minVersion")}
        gltf["asset"] = kept
        _prune_extras(gltf)
        rebuilt = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        if rebuilt != chunk[1].rstrip(b" "):
            changed = True
        chunk[1] = rebuilt
        break

    if not changed:
        return data

    out = bytearray()
    for ctype, body in chunks:
        # JSON chunks pad with spaces, binary chunks with zeros, both to four
        # bytes; the padding is part of the declared chunk length.
        pad = b" " if ctype == CHUNK_JSON else b"\x00"
        body = body + pad * (-len(body) % 4)
        out += struct.pack("<II", len(body), ctype) + body
    return struct.pack("<III", GLB_MAGIC, 2, 12 + len(out)) + bytes(out)


# --------------------------------------------------------------------------
# GIF
# --------------------------------------------------------------------------

# Application extensions worth keeping: the loop count lives in one of these,
# and dropping it turns an animated decoration into a one-shot.
GIF_KEEP_APPS = (b"NETSCAPE2.0", b"ANIMEXTS1.0")


def _gif_skip_subblocks(data, off):
    """Advance past a chain of length-prefixed sub-blocks, terminator included.

    Returns None if the chain runs off the end of the file: a malformed GIF
    must come back out unchanged rather than silently truncated.
    """
    while off < len(data):
        size = data[off]
        off += 1
        if size == 0:
            return off
        off += size
    return None


def strip_gif(data):
    """Drop comment extensions and non-loop application extensions."""
    if not data.startswith(b"GIF8"):
        return data
    off = 6
    if len(data) < 13:
        return data
    packed = data[10]
    off = 13
    if packed & 0x80:  # global color table
        off += 3 * (2 ** ((packed & 0x07) + 1))

    out = bytearray(data[:off])
    while off < len(data):
        block = data[off]
        if block == 0x3B:  # trailer
            out += data[off:]
            off = len(data)
            break
        if block == 0x2C:  # image descriptor
            start = off
            off += 10
            if off > len(data):
                return data
            local = data[off - 1]
            if local & 0x80:
                off += 3 * (2 ** ((local & 0x07) + 1))
            off += 1  # LZW minimum code size
            off = _gif_skip_subblocks(data, off)
            if off is None:
                return data
            out += data[start:off]
            continue
        if block == 0x21:  # extension
            start = off
            if off + 2 >= len(data):
                return data
            label = data[off + 1]
            end = _gif_skip_subblocks(data, off + 2)
            if end is None:
                return data
            if label == 0xFE:  # comment
                off = end
                continue
            if label == 0xFF:  # application
                ident = data[off + 3 : off + 3 + 11]
                if ident not in GIF_KEEP_APPS:
                    off = end
                    continue
            out += data[start:end]
            off = end
            continue
        # Something we do not understand: copy the rest verbatim rather than
        # corrupt the file.
        out += data[off:]
        off = len(data)
        break
    return bytes(out) if bytes(out) != data else data


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# Textual chunks, the timestamp, and an embedded EXIF block. Everything else,
# including the color-management chunks, is left alone.
PNG_DROP = (b"tEXt", b"zTXt", b"iTXt", b"tIME", b"eXIf")


def strip_png(data):
    if not data.startswith(PNG_MAGIC):
        return data
    out = bytearray(PNG_MAGIC)
    off = len(PNG_MAGIC)
    while off + 8 <= len(data):
        (length,) = struct.unpack(">I", data[off : off + 4])
        ctype = data[off + 4 : off + 8]
        end = off + 12 + length
        if end > len(data):
            return data
        if ctype not in PNG_DROP:
            out += data[off:end]
        off = end
        if ctype == b"IEND":
            break
    return bytes(out) if bytes(out) != data else data


# --------------------------------------------------------------------------
# WebP
# --------------------------------------------------------------------------

# Bits in the VP8X flags byte that advertise a metadata chunk.
WEBP_FLAG_EXIF = 0x08
WEBP_FLAG_XMP = 0x04


def strip_webp(data):
    if not (data.startswith(b"RIFF") and data[8:12] == b"WEBP"):
        return data
    body = bytearray()
    off = 12
    dropped = False
    while off + 8 <= len(data):
        ctype = data[off : off + 4]
        (size,) = struct.unpack("<I", data[off + 4 : off + 8])
        end = off + 8 + size + (size & 1)  # chunks pad to an even length
        if end > len(data):
            end = len(data)
        if ctype in (b"EXIF", b"XMP "):
            dropped = True
            off = end
            continue
        chunk = bytearray(data[off:end])
        if ctype == b"VP8X" and size >= 4:
            chunk[8] &= ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP) & 0xFF
        body += chunk
        off = end
    if not dropped and bytes(data[12:]) == bytes(body):
        return data
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + bytes(body)


# --------------------------------------------------------------------------
# JPEG
# --------------------------------------------------------------------------

# Segments that only describe the file: APP1 (EXIF, XMP), APP12 ("Ducky"),
# APP13 (Photoshop / IPTC) and COM. APP0 (JFIF), APP2 (ICC) and APP14 (Adobe)
# affect decoding and stay. The entropy-coded data after SOS is copied verbatim,
# so the pixels are untouched.
JPEG_DROP = (0xE1, 0xEC, 0xED, 0xFE)


def _exif_orientation(seg):
    """The EXIF orientation in an APP1 payload, or None if there is none."""
    if not seg.startswith(b"Exif\x00\x00") or len(seg) < 14:
        return None
    tiff = seg[6:]
    order = {b"II": "<", b"MM": ">"}.get(tiff[:2])
    if order is None:
        return None
    try:
        (ifd,) = struct.unpack(order + "I", tiff[4:8])
        (count,) = struct.unpack(order + "H", tiff[ifd : ifd + 2])
        for i in range(count):
            at = ifd + 2 + 12 * i
            tag, _typ, _n = struct.unpack(order + "HHI", tiff[at : at + 8])
            if tag == 0x0112:
                return struct.unpack(order + "H", tiff[at + 8 : at + 10])[0]
    except struct.error:
        return None
    return None


def strip_jpeg(data):
    if not data.startswith(b"\xff\xd8"):
        return data
    out = bytearray(b"\xff\xd8")
    off = 2
    while off + 4 <= len(data):
        if data[off] != 0xFF:
            return data  # not a marker where one must be: leave it alone
        marker = data[off + 1]
        if marker == 0xFF:  # fill byte
            off += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:  # standalone markers
            out += data[off : off + 2]
            off += 2
            continue
        (length,) = struct.unpack(">H", data[off + 2 : off + 4])
        end = off + 2 + length
        if length < 2 or end > len(data):
            return data
        if marker == 0xDA:  # start of scan: the rest is image data
            out += data[off:]
            break
        payload = data[off + 4 : end]
        drop = marker in JPEG_DROP
        if marker == 0xE1 and (_exif_orientation(payload) or 1) != 1:
            drop = False
        if not drop:
            out += data[off:end]
        off = end
    else:
        return data
    return bytes(out) if bytes(out) != data else data


# --------------------------------------------------------------------------
# MP3
# --------------------------------------------------------------------------


def _id3v2_len(data, off):
    """Size of the ID3v2 tag starting at `off`, or 0 if there is not one."""
    if data[off : off + 3] != b"ID3" or off + 10 > len(data):
        return 0
    flags = data[off + 5]
    size = 0
    for byte in data[off + 6 : off + 10]:
        if byte & 0x80:
            return 0  # not syncsafe: not a tag we understand
        size = (size << 7) | byte
    total = 10 + size
    if flags & 0x10:  # footer present
        total += 10
    return total


def _lame_crc16(chunk):
    """CRC-16/ARC, the checksum the LAME tag stores over its own frame."""
    crc = 0
    for byte in chunk:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def strip_mp3(data):
    """Remove ID3 tags and blank the encoder string in the Xing/Info header.

    ffmpeg writes its version twice: once as an ID3v2 `TSSE` frame, and once as
    the nine-byte encoder field of the LAME extension inside the first frame's
    Xing/Info header. The tag goes away entirely; the encoder field is zeroed in
    place so the frame keeps its length and the seek table beside it survives.
    """
    out = bytes(data)

    # Leading ID3v2 tags (there can be more than one).
    off = 0
    while True:
        size = _id3v2_len(out, off)
        if not size:
            break
        off += size
    out = out[off:]

    # Trailing ID3v1, and the extended tag that may sit in front of it.
    if out[-128:-125] == b"TAG":
        out = out[:-128]
    if out[-227:-223] == b"TAG+":
        out = out[:-227]

    out = _blank_xing_encoder(out)
    return out if out != data else data


def _blank_xing_encoder(data):
    """Zero the LAME encoder string in the first frame's Xing/Info header."""
    head = data[:2048]
    for tag in (b"Xing", b"Info"):
        at = head.find(tag)
        if at < 0:
            continue
        (flags,) = struct.unpack(">I", data[at + 4 : at + 8])
        off = at + 8
        if flags & 0x1:
            off += 4  # frame count
        if flags & 0x2:
            off += 4  # byte count
        if flags & 0x4:
            off += 100  # seek table
        if flags & 0x8:
            off += 4  # VBR quality
        if off + 9 > len(data):
            return data
        encoder = data[off : off + 9]
        if not encoder.strip(b"\x00"):
            return data  # already blank
        out = bytearray(data)
        out[off : off + 9] = b"\x00" * 9
        # The LAME extension ends in a CRC over the frame up to that point. Only
        # rewrite it when the stored value proves this is the real header;
        # otherwise it could be audio.
        frame = _mp3_frame_start(data, at)
        if frame is not None and frame + 192 <= len(data):
            stored = struct.unpack(">H", data[frame + 190 : frame + 192])[0]
            if stored == _lame_crc16(data[frame : frame + 190]):
                struct.pack_into(">H", out, frame + 190, _lame_crc16(out[frame : frame + 190]))
        return bytes(out)
    return data


def _mp3_frame_start(data, tag_at):
    """Offset of the frame header the Xing/Info tag at `tag_at` sits inside."""
    for back in range(tag_at, max(-1, tag_at - 200), -1):
        if data[back] == 0xFF and back + 1 < len(data) and data[back + 1] & 0xE0 == 0xE0:
            return back
    return None
