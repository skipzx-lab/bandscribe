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

You don't need to know git or Python. Copy each command below, paste it into the terminal
window, and press **Enter**. Installing takes 5–15 minutes and about 5 GB of disk space.

### Windows 10 / 11

**1. Open PowerShell.** Press the **Start** button, type `PowerShell`, and press **Enter**.
A window with a blue or black background opens. You'll paste the commands there
with **Ctrl+V** or a right-click.

**2. Install the three tools Bandscribe needs** (Git, Python and ffmpeg). Paste these one at a
time. If Windows asks for permission, click **Yes**.

```powershell
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
```
```powershell
winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
```
```powershell
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
```

**3. Close PowerShell and open it again** (same as step 1), so it can find the tools you just installed.

**4. Download Bandscribe and set it up.** Paste these one at a time:

```powershell
cd $HOME
```
```powershell
git clone https://github.com/skipzx-lab/bandscribe.git
```
```powershell
cd bandscribe
```
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Setup finds your graphics card and installs everything to match. It's done when you see
**Done** in green.

**5. Start it:**

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

Your browser opens Bandscribe at http://localhost:8765. Leave the PowerShell window open while
you use it. To stop Bandscribe, click that window and press **Ctrl+C**.

**Next time**, open PowerShell and paste:

```powershell
cd $HOME\bandscribe; powershell -ExecutionPolicy Bypass -File .\run.ps1
```

### macOS

**1. Open Terminal.** Press **Cmd+Space**, type `Terminal`, and press **Enter**.

**2. Install Homebrew** (a free installer for tools like these). Skip this if you already have it.
It asks for your Mac password; nothing appears while you type it, which is normal. When it
finishes, run the two `echo`/`eval` lines it prints under "Next steps".

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**3. Install Git, Python and ffmpeg:**

```bash
brew install git python@3.12 ffmpeg
```

**4. Download Bandscribe, set it up and start it.** Paste these one at a time:

```bash
cd ~
```
```bash
git clone https://github.com/skipzx-lab/bandscribe.git
```
```bash
cd bandscribe
```
```bash
./setup.sh
```
```bash
./run.sh
```

Your browser opens Bandscribe at http://localhost:8765. Leave Terminal open while you use it,
and press **Ctrl+C** in it to stop. **Next time:** `cd ~/bandscribe && ./run.sh`

### Linux (Ubuntu 24.04)

```bash
sudo apt update && sudo apt install -y git python3 python3-venv ffmpeg
```
```bash
cd ~ && git clone https://github.com/skipzx-lab/bandscribe.git && cd bandscribe
```
```bash
./setup.sh
```
```bash
./run.sh
```

Other distributions work too, as long as the `python3.12` or `python3.11` command exists.
Setup doesn't use newer Pythons yet. On Ubuntu 22.04, install it first with
`sudo apt install -y python3.11 python3.11-venv`. Elsewhere, install Python 3.12 with your
package manager, [pyenv](https://github.com/pyenv/pyenv) or [uv](https://docs.astral.sh/uv/).

### Updating to the latest version

Open the terminal, go into the folder, pull the changes and run setup again:

```powershell
cd $HOME\bandscribe; git pull; powershell -ExecutionPolicy Bypass -File .\setup.ps1
```
```bash
cd ~/bandscribe && git pull && ./setup.sh
```

(The first is for Windows, the second for macOS and Linux.) Your songs are kept.

### Without git

On this page, click the green **Code** button, then **Download ZIP**, and unzip it. On
Windows, open the unzipped folder, click the address bar, type `powershell` and press
**Enter**. That opens PowerShell inside the folder. Then do steps 2–3 above, skip the `git`
and `cd` commands in step 4, and continue with `setup.ps1`. To update, download the ZIP
again and copy your `data` folder (your songs) into the new one.

### If something goes wrong

- **"winget is not recognized":** update **App Installer** from the Microsoft Store, then try again.
- **"py is not recognized" or "Python 3.12 or 3.11 is required":** close and reopen PowerShell
  (step 3). If it still fails, install Python from https://www.python.org/downloads/ and tick
  **"Add python.exe to PATH"** in the installer.
- **"ffmpeg was not found":** close and reopen the terminal, then run the start command again.
- **Choosing the GPU yourself:** setup picks automatically. To override it, add `-Gpu cuda`,
  `-Gpu rocm`, `-Gpu xpu` or `-Gpu cpu` to the setup command on Windows, or pass `cuda`,
  `rocm`, `xpu`, `mps` or `cpu` to `./setup.sh`.
- **Graphics drivers:** for GPU speed, keep your NVIDIA, AMD (26.2.2 or newer) or Intel Arc
  driver up to date.

The first song takes a few extra minutes while the AI models download.

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
