"""Runs one song through separation -> beats -> chords -> lyrics -> a part for each instrument."""
import json
import shutil
from pathlib import Path
from typing import Callable

import librosa
import numpy as np

from . import audio, chords, drums, lyrics, notes, rhythm, separate, tabs

SR = 22050
# (stage id, label, share of total progress)
STAGES = [
    ("prepare", "Decoding audio", 0.03),
    ("separate", "Separating instruments", 0.32),
    ("rhythm", "Finding the beat", 0.05),
    ("chords", "Detecting chords", 0.06),
    ("lyrics", "Transcribing lyrics", 0.27),
    ("parts", "Transcribing each instrument", 0.22),
    ("finish", "Encoding audio", 0.05),
]
STANDARD_TUNING = {"name": "Standard", "strings": tabs.GUITAR, "capo": 0}
GUITAR_SOURCES = ["guitar", "piano", "other"]  # a guitar part is written even if the song has no guitar
PRESENT = 0.05                                  # a stem counts as playing at this share of the mix level

Progress = Callable[[str, str, float], None]


def _load(path: Path) -> np.ndarray:
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y


def _rms(y: np.ndarray) -> float:
    return float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0


def _write(path: Path, data) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def run(job_dir: Path, source: Path, options: dict, progress: Progress) -> dict:
    done = 0.0
    stage_iter = iter(STAGES)

    def step():
        nonlocal done
        sid, label, share = next(stage_iter)
        progress(sid, label, done)
        done += share

    work = job_dir / "work"
    stems_dir = work / "stems"
    audio_dir = job_dir / "audio"
    work.mkdir(exist_ok=True)
    audio_dir.mkdir(exist_ok=True)

    step()
    mix_wav = work / "mix.wav"
    audio.to_wav(source, mix_wav)

    step()
    stems, device = separate.separate(mix_wav, stems_dir)

    step()
    mix = _load(mix_wav)
    tempo, beats, duration = rhythm.track_beats(mix, SR)

    step()
    stem_audio = {name: _load(p) for name, p in stems.items()}
    harm = sum(stem_audio[s] for s in ("guitar", "piano", "other", "bass"))
    chord_res = chords.recognize(harm, stem_audio["bass"], SR, beats, duration)
    phase = rhythm.downbeat_phase(chord_res["beat_labels"])
    measures = rhythm.measures(len(beats), phase)

    step()
    mix_rms = _rms(mix)
    if lyrics.has_vocals(stems["vocals"], mix_rms):
        lyric_res = lyrics.transcribe(stems["vocals"], options.get("whisper_model", "small"),
                                      options.get("language") or None)
    else:
        lyric_res = {"language": None, "lines": []}

    result = {
        "version": 2,
        "duration": duration,
        "device": device,
        "key": chord_res["key"],
        "tempo": round(tempo, 1),
        "beats": [round(float(b), 3) for b in beats],
        "measures": measures,
        "chords": chord_res["segments"],
        "lyrics": lyric_res,
        "tuning": STANDARD_TUNING,
        "stems": sorted(stems),
    }

    step()
    levels = {name: _rms(y) for name, y in stem_audio.items()}
    build_parts(job_dir, result, stems.__getitem__, levels, mix_rms)

    step()
    audio.to_mp3(mix_wav, audio_dir / "mix.mp3")
    for name, path in stems.items():
        audio.to_mp3(path, audio_dir / f"{name}.mp3")
    shutil.rmtree(work, ignore_errors=True)

    _write(job_dir / "result.json", result)
    progress("done", "Done", 1.0)
    return result


def build_parts(job_dir: Path, result: dict, stem_path: Callable[[str], Path],
                levels: dict[str, float], mix_rms: float) -> None:
    """Transcribe each instrument that is playing into result['parts']."""
    playing = {s for s, level in levels.items() if level >= PRESENT * mix_rms}
    loudest = max(GUITAR_SOURCES, key=lambda s: levels.get(s, 0.0))
    guitar_src = "guitar" if levels.get("guitar", 0) >= 0.3 * levels.get(loudest, 0) else loudest

    sources = {"guitar": guitar_src, "bass": "bass", "piano": "piano", "melody": "vocals"}
    parts = {}
    for part, stem in sources.items():
        if part == "guitar" or stem in playing:
            found = notes.detect(stem_path(stem), part)
            _write(job_dir / f"notes_{part}.json", found)
            parts[part] = {"source": stem}
            if part in ("piano", "melody"):
                parts[part]["notes"] = [[n["start"], n["end"], n["pitch"], round(n["amp"], 2)] for n in found]
    if "drums" in playing:
        hits = drums.transcribe(stem_path("drums"))
        parts["drums"] = {"source": "drums", **drums.build_tab(hits, np.array(result["beats"]), result["measures"])}

    result["parts"] = parts
    result.pop("tab", None)
    _retab(job_dir, result)


def load_notes(job_dir: Path, part: str) -> list[dict]:
    path = job_dir / f"notes_{part}.json"
    if not path.exists() and part == "guitar" and (job_dir / "notes.json").exists():
        path = job_dir / "notes.json"  # before per-part notes
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def _retab(job_dir: Path, result: dict) -> None:
    """(Re)build guitar and bass tabs for the current tuning. Chord labels become the shapes
    played: a Db chord on a half-step-down guitar is labelled D."""
    tuning = result.get("tuning", STANDARD_TUNING)
    strings, capo = tuning["strings"], tuning["capo"]
    shift = strings[1] - tabs.GUITAR[1]  # the A string sets the reference
    key = result["key"]
    tonic = chords.FLATS.index(key["tonic"]) if key["tonic"] in chords.FLATS else chords.SHARPS.index(key["tonic"])
    beats = np.array(result["beats"])
    parts = result["parts"]

    if "guitar" in parts:
        flats = chords.uses_flats((tonic - shift - capo) % 12, key["mode"])
        tab = tabs.build_tab(load_notes(job_dir, "guitar"), beats, result["measures"], result["chords"],
                             strings, capo, -shift - capo, flats)
        parts["guitar"] = {"source": parts["guitar"]["source"], **tab}
    if "bass" in parts:  # the bass follows the band's tuning, without a capo
        flats = chords.uses_flats((tonic - shift) % 12, key["mode"])
        tab = tabs.build_tab(load_notes(job_dir, "bass"), beats, result["measures"], result["chords"],
                             [p + shift for p in tabs.BASS], 0, -shift, flats, polyphony=2)
        parts["bass"] = {"source": "bass", **tab}


def _migrate(result: dict) -> None:
    """Results from before parts existed only had a guitar tab."""
    if "parts" not in result and "tab" in result:
        result["parts"] = {"guitar": {"source": result.pop("tab")["source"]}}


def retune(job_dir: Path, result: dict, name: str, strings: list[int], capo: int) -> dict:
    _migrate(result)
    result["tuning"] = {"name": name, "strings": strings, "capo": capo}
    _retab(job_dir, result)
    _write(job_dir / "result.json", result)
    return result


def upgrade(job_dir: Path, result: dict) -> dict:
    """Add every instrument's part to a song processed before parts existed, from its saved stems."""
    _migrate(result)
    audio_dir = job_dir / "audio"
    levels = {s: _rms(_load(audio_dir / f"{s}.mp3")) for s in result["stems"]}
    build_parts(job_dir, result, lambda s: audio_dir / f"{s}.mp3", levels, _rms(_load(audio_dir / "mix.mp3")))
    result["version"] = 2
    _write(job_dir / "result.json", result)
    return result
