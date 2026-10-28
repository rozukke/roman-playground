#!/usr/bin/env bash
# Render the lightweight piano sample set from a local SF2.
# Requirements: fluidsynth, ffmpeg, python3
# Example:
#   nix shell nixpkgs#fluidsynth nixpkgs#ffmpeg nixpkgs#python3 --command \
#     ./scripts/render-piano-samples.sh path/to/Full_Grand_Piano.sf2
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 SOUND_FONT.sf2 [OUTPUT_DIRECTORY]" >&2
  exit 1
fi

soundfont="$1"
output_dir="${2:-public/audio}"
notes=(48 52 56 60 64 68 72 76 80 84)
names=(C3 E3 Ab3 C4 E4 Ab4 C5 E5 Ab5 C6)
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

[[ -f "$soundfont" ]] || { echo "SoundFont not found: $soundfont" >&2; exit 1; }
command -v fluidsynth >/dev/null || { echo "fluidsynth is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
mkdir -p "$output_dir"

# At 120 BPM / 480 ticks per quarter note, 4.5 seconds is 4,320 ticks.
# The final half-second lets the release ring out for a five-second render.
for index in "${!notes[@]}"; do
  midi="${notes[index]}"
  name="${names[index]}"
  midi_file="$temporary_dir/$name.mid"
  wav_file="$temporary_dir/$name.wav"

  MIDI_NOTE="$midi" MIDI_FILE="$midi_file" python3 - <<'PY'
import os
import struct

note = int(os.environ["MIDI_NOTE"])
path = os.environ["MIDI_FILE"]

def vlq(value):
    encoded = [value & 0x7F]
    value >>= 7
    while value:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(encoded))

track = b"".join((
    b"\x00\xFF\x51\x03\x07\xA1\x20",  # 120 BPM
    b"\x00\xC0\x00",                      # acoustic grand piano, program 0
    b"\x00\x90" + bytes((note, 108)),       # note on
    vlq(4320) + b"\x80" + bytes((note, 0)), # release at 4.5 seconds
    vlq(480) + b"\xFF\x2F\x00",            # end at 5 seconds
))
with open(path, "wb") as handle:
    handle.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480))
    handle.write(b"MTrk" + struct.pack(">I", len(track)) + track)
PY

  fluidsynth -ni -g 0.8 -F "$wav_file" -T wav -r 44100 "$soundfont" "$midi_file"
  ffmpeg -hide_banner -loglevel error -y -i "$wav_file" -t 5 -c:a libmp3lame -b:a 64k "$output_dir/$name.mp3"
done

echo "Rendered ${#notes[@]} five-second piano samples to $output_dir"
