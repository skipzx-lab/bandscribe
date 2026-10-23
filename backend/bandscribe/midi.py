"""MIDI export: one track per transcribed part, General MIDI instruments and drum notes."""
import io

import pretty_midi

PROGRAMS = {"guitar": 25, "bass": 33, "piano": 0, "melody": 73}  # steel guitar, finger bass, piano, flute
DRUM_NOTES = {"kick": 36, "snare": 38, "hihat": 42, "crash": 49}


def build(tempo: float, notes: dict[str, list[dict]], hits: list | None = None) -> bytes:
    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    for part, part_notes in notes.items():
        inst = pretty_midi.Instrument(program=PROGRAMS[part], name=part.title())
        for n in part_notes:
            velocity = int(40 + 80 * min(1.0, n["amp"]))
            inst.notes.append(pretty_midi.Note(velocity, n["pitch"], n["start"], max(n["end"], n["start"] + 0.05)))
        pm.instruments.append(inst)
    if hits:
        drums = pretty_midi.Instrument(program=0, is_drum=True, name="Drums")
        for t, kind in hits:
            drums.notes.append(pretty_midi.Note(100, DRUM_NOTES[kind], t, t + 0.1))
        pm.instruments.append(drums)
    buf = io.BytesIO()
    pm.write(buf)
    return buf.getvalue()
