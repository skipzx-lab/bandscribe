"""Beat tracking and a 4/4 measure grid."""
import numpy as np
import librosa

HOP = 512


def track_beats(y: np.ndarray, sr: int) -> tuple[float, np.ndarray, float]:
    """Return (tempo_bpm, beat_times, duration). Beats are extrapolated to cover the whole
    song, with the first beat clipped to t=0 so every moment falls inside some beat."""
    duration = len(y) / sr
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP, units="time")
    tempo = float(np.atleast_1d(tempo)[0]) or 120.0
    beats = np.asarray(beats, dtype=float)

    if len(beats) < 2:
        period = 60.0 / tempo
        return tempo, np.arange(0.0, duration, period), duration

    period = float(np.median(np.diff(beats)))
    pre = np.arange(beats[0] - period, -period, -period)[::-1]
    post = np.arange(beats[-1] + period, duration, period)
    beats = np.concatenate([pre, beats, post])
    beats = beats[beats < duration]
    beats[0] = max(beats[0], 0.0)
    if beats[0] > 0:
        beats = np.concatenate([[0.0], beats])
    return tempo, beats, duration


def downbeat_phase(beat_labels: list[str]) -> int:
    """Guess which beat (mod 4) is the downbeat: chords tend to change on beat 1."""
    counts = np.zeros(4)
    for i in range(1, len(beat_labels)):
        if beat_labels[i] != beat_labels[i - 1]:
            counts[i % 4] += 1
    return int(np.argmax(counts)) if counts.any() else 0


def measures(n_beats: int, phase: int) -> list[dict]:
    """Group beat indices into 4/4 measures; beats before the first downbeat form a pickup."""
    out = []
    if phase > 0:
        out.append({"beat": 0, "beats": phase})
    for start in range(phase, n_beats, 4):
        out.append({"beat": start, "beats": min(4, n_beats - start)})
    return out
