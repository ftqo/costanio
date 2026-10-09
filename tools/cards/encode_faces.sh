#!/usr/bin/env bash
# Encode the untitled card masters into the slot files the game loads.
#
#   encode_faces.sh MASTERS_DIR DEST_DIR
#
# A script rather than a Makefile line because `nix shell ... -c` swallows the
# leading dashes of the command's own flags (see tools/icons/encode_webp.sh).
#
# The masters are the untitled 1000x1400 renders (art/cards/masters); the title
# is drawn at runtime in the player's language. See art/cards/README.md.
#
# Landing a master takes two steps:
#
#   1. Add `<master>:<slot>` to the map below and run `make card-faces`, which
#      downscales the master into frontend/public/assets/<slot>.webp at 256x358.
#   2. Set `"untitled": true` on that slot in
#      frontend/public/assets/manifest.json.
#
# Step 1 alone ships a card with no name; step 2 alone draws a runtime title
# over the old baked one.
#
# A master may feed more than one slot; the extra slots are byte-identical
# copies of the first encode.
#
# Lossy at q92 (~19 KB at 256x358): these are photographic renders and the
# alpha channel is not used.
set -euo pipefail

masters=$1
dest=$2

# master -> the slots that load it. road_building draws both the development
# card and the science progress card.
map=(
  "alchemist:progress_alchemist"
  "bishop:progress_bishop"
  "commercial_harbor:progress_commercial_harbor"
  "constitution:progress_constitution"
  "crane:progress_crane"
  "deserter:progress_deserter"
  "diplomat:progress_diplomat"
  "engineer:progress_engineer"
  "intrigue:progress_intrigue"
  "inventor:progress_inventor"
  "irrigation:progress_irrigation"
  "knight:devcard_knight"
  "master_merchant:progress_master_merchant"
  "medicine:progress_medicine"
  "merchant:progress_merchant"
  "merchant_fleet:progress_merchant_fleet"
  "mining:progress_mining"
  "monopoly:devcard_monopoly"
  "printer:progress_printer"
  "resource_monopoly:progress_resource_monopoly"
  "road_building:devcard_roadbuilding progress_road_building"
  "saboteur:progress_saboteur"
  "smith:progress_smith"
  "spy:progress_spy"
  "trade_monopoly:progress_trade_monopoly"
  "victory_point:devcard_victorypoint"
  "warlord:progress_warlord"
  "wedding:progress_wedding"
  "year_of_plenty:devcard_yearofplenty"
  # The five scenario faces (Raiders x4, Wagons x1). Raiders' Intrigue is a
  # different card from the Politics Intrigue, so raiders ids carry a prefix.
  "raiders_muster:raiders_muster"
  "raiders_swift_rider:raiders_swift_rider"
  "raiders_treason:raiders_treason"
  "raiders_intrigue:raiders_intrigue"
  "swift_journey:devcard_swiftjourney"
)

for entry in "${map[@]}"; do
  name=${entry%%:*}
  slots=${entry#*:}
  src="$masters/$name.webp"
  [ -f "$src" ] || { echo "missing master: $src" >&2; exit 1; }
  first=""
  for slot in $slots; do
    out="$dest/$slot.webp"
    if [ -z "$first" ]; then
      cwebp -quiet -q 92 -resize 256 358 "$src" -o "$out"
      first=$out
    else
      cp "$first" "$out"
    fi
    echo "encoded $out"
  done
done
