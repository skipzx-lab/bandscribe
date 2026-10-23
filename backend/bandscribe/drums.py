"""Drum transcription from the Demucs drum stem: onsets in frequency bands -> kick / snare / hi-hat / crash."""
from pathlib import Path

import librosa
import numpy as np

from .tabs import SLOTS_PER_BEAT, slot_of

SR = 22050
HOP = 256
N_FFT = 1024
# (name, low Hz, high Hz, peak-pick threshold)
BANDS = [
    ("kick", 30, 120, 0.08),
    ("snare", 1500, 5000, 0.08),  # the snare's noisy crack
    ("hihat", 7000, 11000, 0.06),
]
CRASH_RING = 0.3     # seconds: a cymbal still ringing this long after the hit is a crash
CRASH_RATIO = 0.3    # ...if the band keeps this share of its peak energy
MIN_LEVEL = 0.02     # ignore onsets quieter than this share of the band's loud level
LINES = [("CR", "crash", "x"), ("HH", "hihat", "x"), ("SD", "snare", "o"), ("BD", "kick", "o")]
COUNT = "1e+a2e+a3e+a4e+a"


def transcribe(path: Path) -> list[tuple[float, str]]:
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    wait = int(0.06 * SR / HOP)
    ring = int(CRASH_RING * SR / HOP)
    hits = []
    for name, lo, hi, delta in BANDS:
        energy = S[(freqs >= lo) & (freqs < hi)].sum(axis=0)
        env = np.log1p(energy / (np.percentile(energy, 99) + 1e-12) * 100)
        flux = np.maximum(0, np.diff(env, prepend=env[0]))
        flux /= flux.max() + 1e-9
        loud = np.percentile(energy, 99)
        peaks = librosa.util.peak_pick(flux, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=delta, wait=wait)
        for f in peaks:
            if energy[f] < MIN_LEVEL * loud:
                continue
            kind = name
            if name == "hihat":
                after = energy[min(f + ring, len(energy) - 1)]
                if after > CRASH_RATIO * energy[f]:
                    kind = "crash"
            hits.append((round(float(librosa.frames_to_time(f, sr=SR, hop_length=HOP)), 3), kind))
    return sorted(hits)


def build_tab(hits: list[tuple[float, str]], beats: np.ndarray, measures: list[dict]) -> dict:
    """Drum tab on the 16th-note grid, one line per drum, with the count above each bar."""
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    grid: dict[int, set[str]] = {}
    for t, kind in hits:
        grid.setdefault(slot_of(t, beats, period), set()).add(kind)

    out = []
    for m in measures:
        first = m["beat"] * SLOTS_PER_BEAT
        n = m["beats"] * SLOTS_PER_BEAT
        rows = ["".join(mark if kind in grid.get(first + j, ()) else "-" for j in range(n))
                for _, kind, mark in LINES]
        out.append({"beat": m["beat"], "chords": COUNT[:n].ljust(n + 1), "strings": [r + "|" for r in rows]})
    return {
        "string_names": [label for label, _, _ in LINES],
        "note_count": len(hits),
        "measures": out,
        "hits": [[t, k] for t, k in hits],
    }
