#!/usr/bin/env bash
#
# setup_resources.sh
#
# Downloads the large binary resources (fonts and background music) that are
# intentionally kept out of git for this repository. These files live in the
# upstream MoneyPrinterTurbo project and are required at runtime for video
# rendering (subtitle fonts) and for the "use a random/local background song"
# feature.
#
# Usage:
#   bash scripts/setup_resources.sh
#
# Re-running is safe: existing, non-empty files are skipped unless FORCE=1.
#
set -euo pipefail

UPSTREAM="${MPT_UPSTREAM:-https://raw.githubusercontent.com/harry0703/MoneyPrinterTurbo/main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE="${FORCE:-0}"

FONTS=(
  "BeVietnamPro-Bold.ttf"
  "BeVietnamPro-Medium.ttf"
  "Charm-Bold.ttf"
  "Charm-Regular.ttf"
  "MicrosoftYaHeiBold.ttc"
  "MicrosoftYaHeiNormal.ttc"
  "STHeitiLight.ttc"
  "STHeitiMedium.ttc"
  "UTM Kabel KT.ttf"
)

# Note: upstream skips output026.mp3, so the list is enumerated explicitly
# rather than generated from a numeric range.
SONGS=(
  output000.mp3 output001.mp3 output002.mp3 output003.mp3 output004.mp3
  output005.mp3 output006.mp3 output007.mp3 output008.mp3 output009.mp3
  output010.mp3 output011.mp3 output012.mp3 output013.mp3 output014.mp3
  output015.mp3 output016.mp3 output017.mp3 output018.mp3 output019.mp3
  output020.mp3 output021.mp3 output022.mp3 output023.mp3 output024.mp3
  output025.mp3 output027.mp3 output028.mp3 output029.mp3
)

download() {
  # $1 = subdir under resource/ , $2 = filename
  local subdir="$1" name="$2"
  local dest_dir="$ROOT/resource/$subdir"
  local dest="$dest_dir/$name"
  mkdir -p "$dest_dir"

  if [ "$FORCE" != "1" ] && [ -s "$dest" ]; then
    echo "  skip (exists): resource/$subdir/$name"
    return 0
  fi

  # URL-encode spaces in the path (e.g. "UTM Kabel KT.ttf").
  local enc_name="${name// /%20}"
  local url="$UPSTREAM/resource/$subdir/$enc_name"

  local code
  code=$(curl -fsSL -w "%{http_code}" -o "$dest" "$url" || true)
  if [ "$code" = "200" ] && [ -s "$dest" ]; then
    echo "  ok: resource/$subdir/$name"
  else
    rm -f "$dest"
    echo "  FAILED ($code): $url" >&2
    return 1
  fi
}

main() {
  echo "Downloading fonts -> resource/fonts/"
  local rc=0
  for f in "${FONTS[@]}"; do download fonts "$f" || rc=1; done

  echo "Downloading background music -> resource/songs/"
  for s in "${SONGS[@]}"; do download songs "$s" || rc=1; done

  if [ "$rc" -ne 0 ]; then
    echo "One or more resources failed to download." >&2
    exit 1
  fi
  echo "Done. Fonts and background music are ready."
}

main "$@"
