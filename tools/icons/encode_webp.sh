#!/usr/bin/env bash
# Encode the icon bakes into the slot files the game loads.
#
#   encode_webp.sh PROTO_DIR DEST_DIR name [name...]
#
# A script rather than a Makefile line because `nix shell ... -c` swallows the
# leading dashes of the command's own flags; with
# `nix shell nixpkgs#libwebp -c bash tools/icons/encode_webp.sh ...` the first
# word after -c has none.
#
# Lossless because the props are hard-edged with a solid contour, which lossy
# WebP handles worst. `-exact` keeps the RGB of fully transparent pixels, which
# would otherwise show as a halo on the dark panel.
set -euo pipefail

proto=$1
dest=$2
shift 2

for n in "$@"; do
  src="$proto/$n-o0026-96.png"
  out="$dest/icon_$n.webp"
  [ -f "$src" ] || { echo "missing bake: $src" >&2; exit 1; }
  cwebp -quiet -lossless -exact "$src" -o "$out"
  echo "encoded $out"
done
