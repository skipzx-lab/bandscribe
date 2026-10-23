"""Beat-synchronous chord recognition: chroma template matching + bass root + HMM smoothing."""
import re

import numpy as np
import librosa

from .rhythm import HOP

SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# suffix -> (intervals, prior penalty). Richer chords need more evidence to be chosen.
QUALITIES = {
    "": ([0, 4, 7], 0.0),
    "m": ([0, 3, 7], 0.0),
    "7": ([0, 4, 7, 10], 0.035),
    "maj7": ([0, 4, 7, 11], 0.04),
    "m7": ([0, 3, 7, 10], 0.035),
    "sus4": ([0, 5, 7], 0.03),
    "sus2": ([0, 2, 7], 0.03),
    "dim": ([0, 3, 6], 0.05),
}
BASE = {"": "maj", "7": "maj", "maj7": "maj", "m": "min", "m7": "min", "dim": "dim"}

# Krumhansl-Kessler key profiles
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
FLAT_MAJOR_KEYS = {5, 10, 3, 8, 1, 6}  # F Bb Eb Ab Db Gb

STAY_PROB = 0.82
BETA = 25.0
BASS_WEIGHT = 0.12
DIATONIC_BONUS = 0.03


def _states():
    states = []
    for root in range(12):
        for suffix, (ivs, penalty) in QUALITIES.items():
            t = np.zeros(12)
            t[[(root + i) % 12 for i in ivs]] = 1.0
            states.append((root, suffix, t / np.linalg.norm(t), penalty))
    return states


def estimate_key(chroma_mean: np.ndarray) -> tuple[int, str]:
    best = (-2.0, 0, "major")
    for tonic in range(12):
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            r = np.corrcoef(np.roll(profile, tonic), chroma_mean)[0, 1]
            if r > best[0]:
                best = (r, tonic, mode)
    return best[1], best[2]


def _diatonic(tonic: int, mode: str) -> set[tuple[int, str]]:
    major_tonic = tonic if mode == "major" else (tonic + 3) % 12
    degrees = [(0, "maj"), (2, "min"), (4, "min"), (5, "maj"), (7, "maj"), (9, "min"), (11, "dim")]
    return {((major_tonic + d) % 12, q) for d, q in degrees}


def uses_flats(tonic: int, mode: str) -> bool:
    major_tonic = tonic if mode == "major" else (tonic + 3) % 12
    return major_tonic in FLAT_MAJOR_KEYS


_NAME_RE = re.compile(r"^([A-G][#b]?)(.*?)(?:/([A-G][#b]?))?$")


def _pitch_class(note: str) -> int:
    return SHARPS.index(note) if note in SHARPS else FLATS.index(note)


def transpose_name(name: str, semis: int, flats: bool) -> str:
    """Shift a chord name like 'Bbm7' or 'D/F#' by `semis` semitones."""
    m = _NAME_RE.match(name)
    if not semis or name == "N" or not m:
        return name
    names = FLATS if flats else SHARPS
    root = names[(_pitch_class(m[1]) + semis) % 12]
    bass = "/" + names[(_pitch_class(m[3]) + semis) % 12] if m[3] else ""
    return root + m[2] + bass


def _beat_aggregate(feat: np.ndarray, bounds: np.ndarray) -> np.ndarray:
    cols = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        cols.append(np.median(feat[:, a:max(b, a + 1)], axis=1))
    return np.stack(cols, axis=1)


def recognize(harm: np.ndarray, bass: np.ndarray, sr: int, beats: np.ndarray, duration: float) -> dict:
    chroma = librosa.feature.chroma_cqt(y=harm, sr=sr, hop_length=HOP)
    bchroma = librosa.feature.chroma_cqt(
        y=bass, sr=sr, hop_length=HOP, fmin=librosa.note_to_hz("E1"), n_octaves=3
    )
    n = min(chroma.shape[1], bchroma.shape[1])
    chroma, bchroma = chroma[:, :n], bchroma[:, :n]
    harm_rms = librosa.feature.rms(y=harm, hop_length=HOP)[:, :n]
    bass_rms = librosa.feature.rms(y=bass, hop_length=HOP)[:, :n]

    times = np.append(beats, duration)
    bounds = np.clip(librosa.time_to_frames(times, sr=sr, hop_length=HOP), 0, n)
    C = _beat_aggregate(chroma, bounds)
    B = _beat_aggregate(bchroma, bounds)
    E = _beat_aggregate(harm_rms, bounds)[0]
    BE = _beat_aggregate(bass_rms, bounds)[0]

    tonic, mode = estimate_key(chroma.mean(axis=1))
    diatonic = _diatonic(tonic, mode)
    names = FLATS if uses_flats(tonic, mode) else SHARPS

    Cn = C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)
    Bn = B / (B.sum(axis=0, keepdims=True) + 1e-9)
    bass_presence = np.clip(BE / (0.25 * np.percentile(BE, 95) + 1e-9), 0, 1)
    quiet = E < 0.08 * np.percentile(E, 95)

    states = _states()
    S = np.zeros((len(states) + 1, C.shape[1]))
    for k, (root, suffix, template, penalty) in enumerate(states):
        bonus = DIATONIC_BONUS if (root, BASE.get(suffix)) in diatonic else 0.0
        S[k] = template @ Cn - penalty + bonus + BASS_WEIGHT * bass_presence * Bn[root]
    S[-1] = np.where(quiet, 1.0, 0.3)  # "N" = no chord

    P = np.exp(BETA * (S - S.max(axis=0, keepdims=True)))
    P /= P.sum(axis=0, keepdims=True)
    n_states = P.shape[0]
    trans = np.full((n_states, n_states), (1 - STAY_PROB) / (n_states - 1))
    np.fill_diagonal(trans, STAY_PROB)
    path = librosa.sequence.viterbi(P, trans)

    labels = []
    for k in path:
        if k == len(states):
            labels.append("N")
        else:
            root, suffix, _, _ = states[k]
            labels.append(names[root] + suffix)

    segments = []
    for i, label in enumerate(labels):
        start, end = float(times[i]), float(times[i + 1])
        if segments and segments[-1]["chord"] == label:
            segments[-1]["end"] = end
        else:
            segments.append({"start": start, "end": end, "chord": label})

    return {
        "key": {"tonic": names[tonic], "mode": mode, "name": f"{names[tonic]} {mode}"},
        "beat_labels": labels,
        "segments": segments,
    }
