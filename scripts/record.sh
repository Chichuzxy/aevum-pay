#!/usr/bin/env bash
# Record one demo segment of the whole screen with ffmpeg (no OBS, no 剪映).
#
#   bash scripts/record.sh seg1 14      # 3-2-1 countdown, then 14 seconds -> video/raw/seg1.mp4
#
# Before running: close every window you do not want on camera, put the windows you DO
# want in the layout described in docs/RECORDING-RUNBOOK.md, and start the 3 demo servers
# (see step 2 of that file). The recorder grabs the primary display at 30 fps.
set -euo pipefail
cd "$(dirname "$0")/.."

name="${1:-seg1}"
seconds="${2:-15}"
out="video/raw/${name}.mp4"
mkdir -p video/raw

FFMPEG="${FFMPEG:-}"
if [ -z "$FFMPEG" ]; then
  for candidate in tools/ffmpeg-*/bin/ffmpeg.exe; do
    [ -f "$candidate" ] && FFMPEG="$candidate" && break
  done
fi
if [ -z "$FFMPEG" ]; then
  command -v ffmpeg >/dev/null 2>&1 && FFMPEG=ffmpeg || { echo "ffmpeg not found (tools/ or PATH)"; exit 1; }
fi

echo "Recording ${name} for ${seconds}s -> ${out}"
echo "3..."; sleep 1
echo "2..."; sleep 1
echo "1..."; sleep 1
"$FFMPEG" -y -f gdigrab -framerate 30 -i desktop -t "$seconds" \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart "$out" 2>/dev/null
echo "saved ${out}"
"$(dirname "$FFMPEG")/ffprobe.exe" -v error -show_entries format=duration:stream=width,height,r_frame_rate \
  -of default=noprint_wrappers=1 "$out" 2>/dev/null || true
