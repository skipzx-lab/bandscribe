# Bandscribe

Made a song with AI (Suno, Udio, …) and want to actually play it? Bandscribe listens to the
track and writes out a part for every instrument: a chord sheet with lyrics, guitar and bass
tabs, piano, drums and the vocal melody. Everything runs on your own computer, with no
accounts and no uploads.

- **Chord sheet:** chords placed over the lyrics, with section headings. Paste your own lyrics
  (Suno gives you them) and they're timed to the song.
- **Guitar tab:** playable fingerings in any tuning (half step down, Drop D, DADGAD, …) and
  with a capo. If the chords look like open shapes in a down-tuning, Bandscribe suggests it.
- **Bass tab:** 4-string tab that follows the band's tuning.
- **Piano:** a scrolling piano roll of the keys part, plus a **live keyboard** that shows the
  chord to play right now (voice-led, bass note in the left hand), the next chord, and the
  notes the piano track is playing.
- **Drums:** drum tab (kick, snare, hi-hat, crash) on a 16th-note grid.
- **Melody:** the sung line as notes with the lyrics underneath, playable on any instrument.
- **Chord diagrams** for guitar, ukulele and piano. Transpose to any key.
- **MIDI export** for any part, or all of them, for MuseScore (sheet music) or your DAW.
- **Play along:** the page follows the song, highlights the current word, chord and bar, and
  lets you listen to the full mix or any single instrument.

> Automatic transcription gives you a solid first draft, not a perfect score. Chords and lyrics
> are editable in place; check tabs by ear.

## Install

You need **Python 3.12 or 3.11** and **ffmpeg** (`winget install Gyan.FFmpeg`,
`brew install ffmpeg` or `apt install ffmpeg`).

```powershell
# Windows
.\setup.ps1          # detects your GPU and installs the matching PyTorch build
.\run.ps1            # opens http://localhost:8765
```

```bash
# Linux / macOS
./setup.sh
./run.sh
```

Force a build with `.\setup.ps1 -Gpu cuda|rocm|xpu|cpu` or `./setup.sh cuda|rocm|xpu|mps|cpu`.
The first song takes a few extra minutes while the models download.

### Hardware

Everything works on the CPU. A GPU speeds up stem separation (the slowest step), and on
NVIDIA the lyrics too.

| Hardware | Stem separation | Lyrics |
|---|---|---|
| NVIDIA RTX 20-series and newer | GPU (CUDA 12.8) | GPU |
| AMD Radeon RX 7000/9000, Ryzen AI Max 300, selected Ryzen AI 300/400 | GPU (ROCm; Windows needs Python 3.12 and driver 26.2.2+) | CPU |
| Intel Arc, including Core Ultra integrated graphics | GPU (XPU) | CPU |
| Apple silicon | GPU (MPS) | CPU |
| Anything else (older iGPUs, Radeon 780M on Windows, …) | CPU | CPU |

If a GPU build doesn't support your card, setup installs the CPU build instead.

## How it works

1. **Demucs** (`htdemucs_6s`) splits the song into vocals, guitar, bass, piano, drums and other.
2. **librosa** tracks the beat; bars come from where chords change.
3. **Chords:** chroma templates with bass-note weighting and a key prior, smoothed with an HMM,
   one decision per beat.
4. **Lyrics:** faster-whisper on the vocal stem, or your pasted lyrics aligned to its word timings.
5. **Notes:** Spotify's **Basic Pitch** on each stem (guitar, bass, piano, vocals).
6. **Tabs:** a Viterbi search picks string/fret positions that are playable and keep the hand still.
7. **Drums:** onsets in the kick, snare and cymbal frequency bands of the drum stem.

Songs, stems and results are stored in `data/` next to the app (set `BANDSCRIBE_DATA` to move it).

## Settings

| Variable | Effect |
|---|---|
| `BANDSCRIBE_DATA` | Where songs and results are stored |
| `BANDSCRIBE_DEVICE` | Force the separation device: `cuda`, `xpu`, `mps` or `cpu` |
| `BANDSCRIBE_WHISPER_DEVICE` | Force the lyrics device: `cuda` or `cpu` |

The server listens on `127.0.0.1` only and has no login. Don't expose it to a network you don't trust.

## Credits

Built on [Demucs](https://github.com/facebookresearch/demucs) (MIT),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) with OpenAI Whisper (MIT),
[Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0),
[librosa](https://github.com/librosa/librosa) (ISC), [pretty_midi](https://github.com/craffel/pretty-midi) (MIT)
and [FastAPI](https://github.com/fastapi/fastapi) (MIT).

Only transcribe music you have the right to use.

## License

MIT
