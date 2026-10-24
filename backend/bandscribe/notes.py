"""Note detection with Spotify's Basic Pitch (ONNX model on onnxruntime, so no TensorFlow)."""
from pathlib import Path

import numpy as np

# Per-part settings: the stem's frequency range, how confident the model must be, and the
# MIDI pitch range kept. Bass and melody lines are reduced to one note at a time.
# `fold` (low, high) moves notes by octaves into that range.
PROFILES = {
    "guitar": dict(min_hz=60.0, max_hz=1400.0, onset=0.6, frame=0.35, min_ms=80, lowest=35, highest=83, mono=False,
                   articulate=True),
    # Basic Pitch often hears a bass note's overtone, so bass notes are folded by octaves
    # into the range a bass line actually sits in (D1 to E3).
    "bass": dict(min_hz=28.0, max_hz=400.0, onset=0.5, frame=0.3, min_ms=100, lowest=23, highest=67, mono=True,
                 fold=(26, 52), articulate=True),
    "piano": dict(min_hz=27.5, max_hz=4200.0, onset=0.5, frame=0.3, min_ms=60, lowest=21, highest=108, mono=False),
    "melody": dict(min_hz=80.0, max_hz=1100.0, onset=0.5, frame=0.3, min_ms=100, lowest=40, highest=84, mono=True),
}
MIN_AMP = 0.2
SAME_ONSET = 0.05  # seconds: notes starting this close together count as simultaneous
FRAMES_PER_SEC = 22050 / 256  # Basic Pitch's output frame rate
BEND_BINS = 3                 # pitch-bend units per semitone


def detect(path: Path, profile: str) -> list[dict]:
    import basic_pitch
    from basic_pitch.inference import predict

    p = PROFILES[profile]
    model = Path(basic_pitch.__file__).parent / "saved_models" / "icassp_2022" / "nmp.onnx"
    output, _, events = predict(
        str(path),
        str(model),
        onset_threshold=p["onset"],
        frame_threshold=p["frame"],
        minimum_note_length=p["min_ms"],
        minimum_frequency=p["min_hz"],
        maximum_frequency=p["max_hz"],
    )
    notes = []
    for s, e, n, a, *rest in events:
        if not (p["lowest"] <= n <= p["highest"] and a >= MIN_AMP):
            continue
        note = {"start": round(float(s), 3), "end": round(float(e), 3), "pitch": int(n), "amp": round(float(a), 3)}
        if p.get("articulate"):
            note.update(_articulation(output["onset"], float(s), int(n), rest[0] if rest else None))
        notes.append(note)
    if "fold" in p:
        lo, hi = p["fold"]
        for n in notes:
            while n["pitch"] > hi:
                n["pitch"] -= 12
            while n["pitch"] < lo:
                n["pitch"] += 12
    notes.sort(key=lambda n: (n["start"], n["pitch"]))
    return monophonic(notes) if p["mono"] else notes


def _articulation(onsets, start: float, pitch: int, bends) -> dict:
    """How hard the note was struck (a hammer-on, pull-off or slide barely registers as an onset)
    and how far below or above its pitch it starts, in semitones (a slide glides in)."""
    f = int(round(start * FRAMES_PER_SEC))
    col = onsets[max(f - 2, 0):f + 3, pitch - 21]
    attack = float(col.max()) if col.size else 0.0
    # Relative to the rest of the note, so a slightly sharp or flat recording reads as no glide.
    glide = float(np.mean(bends[:3]) - np.median(bends)) / BEND_BINS if bends and len(bends) > 3 else 0.0
    return {"attack": round(attack, 3), "glide": round(glide, 2)}


def monophonic(notes: list[dict]) -> list[dict]:
    """One note at a time: of simultaneous notes the loudest wins, and a new note cuts off the last."""
    out: list[dict] = []
    for n in notes:
        if out and n["start"] < out[-1]["end"]:
            if n["start"] - out[-1]["start"] < SAME_ONSET:
                if n["amp"] > out[-1]["amp"]:
                    out[-1] = dict(n)
                continue
            out[-1]["end"] = n["start"]
        out.append(dict(n))
    return out
