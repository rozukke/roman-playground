# Piano sample attribution

The files in this directory are a reduced set of samples rendered from the local **Full Grand Piano** SoundFont (`Full_Grand_Piano.sf2`).

- Source soundfont: Full_Grand_Piano.sf2
- License: [Free Art License 1.3](https://artlibre.org/licence/lal/en/)
- This app retains a five-second MP3 every four semitones (C, E, and Ab across C3–C6); Web Audio pitch-shifts the nearest sample for the other notes.
- Reproduction: run `scripts/render-piano-samples.sh` with FluidSynth, FFmpeg, Python 3, and the source SF2 available at `~/downloads/Full_Grand_Piano.sf2`.

The samples are served as static project assets and are not fetched from a third-party host at runtime.
