#!/usr/bin/env bash
# prepare-demo-assets.sh <film.mp4> [style-thumbs-dir]
#
# Builds the assets the demo engine plays back: for each of 6 scenes, 8 colour frames cut from a finished
# Inkframe-style cartoon, plus a pencil "sketch" twin of every frame, a 720p copy of the film (the demo's
# "built MP4"), and waveform peaks of its sound track. Output: public/demo/ and lib/engine/demo-catalog.json.
# Needs ffmpeg/ffprobe and node. The repo ships the result, so you only run this to swap the demo film.
set -euo pipefail
FILM="${1:?usage: prepare-demo-assets.sh <film.mp4> [style-thumbs-dir]}"
THUMBS="${2:-}"
cd "$(dirname "$0")/.."
OUT=public/demo; mkdir -p "$OUT/frames" "$OUT/styles"

# scene n: start and end second inside the film
SCENES=("0.6 8" "8.6 16" "16.6 24" "25 41.5" "42.6 50.6" "59.8 66.6")
SKETCH="format=gray,edgedetect=low=0.06:high=0.18:mode=wires,negate,erosion,format=rgb24,colorchannelmixer=rr=.96:gg=.92:bb=.84"
for i in "${!SCENES[@]}"; do
  read -r a b <<<"${SCENES[$i]}"; n=$((i + 1))
  for k in 0 1 2 3 4 5 6 7; do
    t=$(node -e "console.log(($a + ($b - $a) * $k / 7.3).toFixed(2))")
    f="$OUT/frames/s${n}-$k.jpg"
    ffmpeg -v error -y -ss "$t" -i "$FILM" -frames:v 1 -vf scale=640:360 -q:v 4 "$f"
    ffmpeg -v error -y -i "$f" -vf "$SKETCH" -q:v 5 "$OUT/frames/s${n}-$k-sketch.jpg"
  done
done

# the "finished" video the demo hands out
ffmpeg -v error -y -i "$FILM" -vf scale=1280:720 -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart "$OUT/result.mp4"

# waveform peaks (600 bins) of the sound track: the voice lane shows them as is, the music lane smoothed
ffmpeg -v error -i "$FILM" -ac 1 -ar 8000 -f s16le - | node -e '
  const chunks = []; process.stdin.on("data", c => chunks.push(c)).on("end", () => {
    const b = Buffer.concat(chunks), n = b.length / 2, bins = 600, per = Math.floor(n / bins), peaks = [];
    for (let i = 0; i < bins; i++) { let m = 0; for (let j = 0; j < per; j += 4) m = Math.max(m, Math.abs(b.readInt16LE((i * per + j) * 2))); peaks.push(m); }
    const top = Math.max(...peaks) || 1;
    console.log(JSON.stringify(peaks.map(v => +(v / top).toFixed(3))));
  });' > "$OUT/peaks.json"

if [ -n "$THUMBS" ]; then
  for f in k10 k3 k44 st-istoriya st-reels st-nauka st-doska; do
    ffmpeg -v error -y -i "$THUMBS/$f.jpg" -vf "scale=400:-2" -q:v 4 "$OUT/styles/$f.jpg"
  done
fi
echo "demo assets: $(ls "$OUT/frames" | wc -l) frames, $(du -h "$OUT/result.mp4" | cut -f1) film"
