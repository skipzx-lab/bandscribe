"""Fretted-instrument tablature: notes -> 16th-note grid -> playable fretting via Viterbi."""
import bisect

import numpy as np

from .chords import FLATS, transpose_name

GUITAR = [40, 45, 50, 55, 59, 64]  # MIDI pitches of the open strings, low E to high e
BASS = [28, 33, 38, 43]            # E A D G
MAX_FRET = 19
MAX_SPAN = 5
SLOTS_PER_BEAT = 4
TOP_CANDIDATES = 40
MOVE_COST = 0.25
# Bleed from other instruments comes through quiet and with almost no attack.
GHOST_ATTACK, GHOST_AMP = 0.35, 0.55
# Consecutive notes join into a hammer-on, pull-off or slide when the first rings into the second,
# they are a short step apart and close in time. A slide shows as a glide into the second note.
LEGATO_GAP = 0.08    # seconds the first note may stop short of the second
LEGATO_STEP = 2      # semitones (4 for a pull-off to an open string)
LEGATO_SLOTS = 3     # 16ths between the two notes
SLIDE_GLIDE = 0.2    # semitones
STRING_CHANGE_COST = 0.6  # keeps a legato pair on one string, unless that means leaving position


def string_names(strings: list[int]) -> list[str]:
    """Names for each string, high to low, padded to equal width (e.g. 'eb', 'Bb', ... 'Eb')."""
    names = [FLATS[p % 12] for p in reversed(strings)]
    if names[0] == names[-1]:
        names[0] = names[0].lower()
    width = max(len(n) for n in names)
    return [n.ljust(width) for n in names]


def slot_of(t: float, beats: np.ndarray, period: float) -> int:
    """Index of the nearest 16th-note slot."""
    i = max(bisect.bisect_right(beats, t) - 1, 0)
    nxt = beats[i + 1] if i + 1 < len(beats) else beats[i] + period
    sub = round((t - beats[i]) / max(nxt - beats[i], 1e-3) * SLOTS_PER_BEAT)
    return i * SLOTS_PER_BEAT + sub


def slot_time(slot: int, beats: np.ndarray, period: float) -> float:
    beat_i = min(slot // SLOTS_PER_BEAT, len(beats) - 1)
    return beats[beat_i] + (slot % SLOTS_PER_BEAT) / SLOTS_PER_BEAT * period


def _fingerings(pitches: list[int], tuning: list[int]) -> list[tuple[float, tuple, float | None]]:
    """All playable (string, fret) assignments for a set of simultaneous pitches, best first.
    `tuning` is high string first; frets are relative to the capo."""
    n = len(tuning)
    options = [[(s, p - tuning[s]) for s in range(n) if 0 <= p - tuning[s] <= MAX_FRET] for p in pitches]
    options = [o for o in options if o]  # pitches below the lowest string can't be played
    results = []

    def walk(i, used, combo, lo, hi):
        if i == len(options):
            frets = [f for _, f in combo if f > 0]
            center = float(np.mean(frets)) if frets else None
            span = (hi - lo) if frets else 0
            cost = 0.04 * (center or 0) + 0.6 * max(0, span - 3) - 0.05 * (len(combo) - len(frets))
            results.append((cost, tuple(combo), center))
            return
        for s, f in options[i]:
            if s in used:
                continue
            nlo, nhi = (min(lo, f), max(hi, f)) if f > 0 else (lo, hi)
            if f > 0 and nhi - nlo > MAX_SPAN:
                continue
            walk(i + 1, used | {s}, combo + [(s, f)], nlo, nhi)

    if options:
        walk(0, frozenset(), [], 99, -1)
    results.sort(key=lambda r: r[0])
    return results[:TOP_CANDIDATES]


def _string_of(combo: tuple, pitch: int, tuning: list[int]) -> int | None:
    return next((s for s, f in combo if tuning[s] + f == pitch), None)


def _assign(events: list[list[int]], tuning: list[int], links: dict[int, tuple[int, int]] | None = None) -> list[tuple]:
    """Viterbi over events so the hand moves as little as possible. `links[k]` = (pitch in event
    k-1, pitch in event k) that should share a string, for a hammer-on, pull-off or slide."""
    links = links or {}
    cands = []
    for pitches in events:
        pitches = list(pitches)
        found = _fingerings(pitches, tuning)
        while not found and len(pitches) > 1:
            pitches.pop()  # drop the weakest note until it becomes playable
            found = _fingerings(pitches, tuning)
        cands.append(found or [(0.0, (), None)])

    scores = [[c[0] for c in cands[0]]]
    back = [[0] * len(cands[0])]
    centers_prev = [c[2] for c in cands[0]]
    for k in range(1, len(cands)):
        row, brow = [], []
        link = links.get(k)
        for cost, combo, center in cands[k]:
            best, arg = float("inf"), 0
            here = _string_of(combo, link[1], tuning) if link else None
            for j, prev in enumerate(scores[-1]):
                pc = centers_prev[j]
                move = MOVE_COST * abs(center - pc) if center is not None and pc is not None else 0.0
                if link and here != _string_of(cands[k - 1][j][1], link[0], tuning):
                    move += STRING_CHANGE_COST
                if prev + move < best:
                    best, arg = prev + move, j
            row.append(best + cost)
            brow.append(arg)
        scores.append(row)
        back.append(brow)
        centers_prev = [c[2] for c in cands[k]]

    idx = int(np.argmin(scores[-1]))
    out = []
    for k in range(len(cands) - 1, -1, -1):
        out.append(cands[k][idx][1])
        idx = back[k][idx]
    return out[::-1]


def _legato_links(slots: list[int], events: list[list[int]], by_slot: dict) -> dict[int, tuple[int, int]]:
    """Pairs of notes in consecutive events that look like one hand movement on one string."""
    links = {}
    for k in range(1, len(slots)):
        if slots[k] - slots[k - 1] > LEGATO_SLOTS or len(events[k]) > 2:
            continue
        best = None
        for p2 in events[k]:
            n2 = by_slot[slots[k]][p2]
            for p1 in events[k - 1]:
                n1 = by_slot[slots[k - 1]][p1]
                step = abs(p2 - p1)
                if 0 < step <= 4 and n1["end"] >= n2["start"] - LEGATO_GAP and (best is None or step < best[0]):
                    best = (step, p1, p2)
        if best:
            links[k] = best[1:]
    return links


def _articulations(slots: list[int], fingered: dict, links: dict, by_slot: dict,
                   tuning: list[int]) -> dict[tuple[int, int], str]:
    """(slot, string) -> 'h', 'p', '/' or '\' leading into the note at that slot."""
    marks = {}
    order = []
    for k, (p1, p2) in sorted(links.items()):
        s1, s2 = slots[k - 1], slots[k]
        a = _string_of(fingered.get(s1, ()), p1, tuning)
        b = _string_of(fingered.get(s2, ()), p2, tuning)
        if a is None or a != b:
            continue
        f1, f2 = p1 - tuning[a], p2 - tuning[a]
        if abs(f1 - f2) > LEGATO_STEP and f2 != 0:
            continue
        glide = by_slot[s2][p2].get("glide", 0.0)
        up = f2 > f1
        if f2 != 0 and ((up and glide <= -SLIDE_GLIDE) or (not up and glide >= SLIDE_GLIDE)):
            mark = "/" if up else "\\"
        else:
            mark = "h" if up else "p"
        marks[(s2, a)] = mark
        order.append((s1, s2, a))
    # A slide up and back (2/4\2) is one movement: if either half glides, both are slides.
    for (s1, s2, a), (t1, t2, b) in zip(order, order[1:]):
        if s2 == t1 and a == b:
            m1, m2 = marks[(s2, a)], marks[(t2, a)]
            if m1 in "/\\" and m2 in "hp" and _fret(fingered, t2, a) == _fret(fingered, s1, a) != 0:
                marks[(t2, a)] = "/" if m1 == "\\" else "\\"
            elif m2 in "/\\" and m1 in "hp" and _fret(fingered, t2, a) == _fret(fingered, s1, a) != 0:
                marks[(s2, a)] = "/" if m2 == "\\" else "\\"
    return marks


def _fret(fingered: dict, slot: int, string: int) -> int | None:
    return next((f for s, f in fingered.get(slot, ()) if s == string), None)


def chord_at(segments: list[dict], starts: list[float], t: float) -> str:
    i = max(bisect.bisect_right(starts, t) - 1, 0)
    return segments[i]["chord"] if segments else "N"


def build_tab(notes: list[dict], beats: np.ndarray, measures: list[dict], segments: list[dict],
              strings: list[int] = GUITAR, capo: int = 0,
              chord_shift: int = 0, flats: bool = False, polyphony: int = 6) -> dict:
    """Lay notes out as tab for `strings` (open-string pitches, low to high) with a capo.
    Chord labels are shifted by `chord_shift` so they name the shapes being played."""
    tuning = [p + capo for p in reversed(strings)]
    n_strings = len(tuning)
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5

    by_slot: dict[int, dict[int, dict]] = {}
    for n in notes:
        if n.get("attack", 1.0) < GHOST_ATTACK and n["amp"] < GHOST_AMP:
            continue
        bucket = by_slot.setdefault(slot_of(n["start"], beats, period), {})
        if n["pitch"] not in bucket or n["amp"] > bucket[n["pitch"]]["amp"]:
            bucket[n["pitch"]] = n

    slots = sorted(by_slot)
    events = [sorted(by_slot[s], key=lambda p: -by_slot[s][p]["amp"])[:polyphony] for s in slots]
    links = _legato_links(slots, events, by_slot)
    fingered = dict(zip(slots, _assign(events, tuning, links))) if events else {}
    marks = _articulations(slots, fingered, links, by_slot, tuning)

    seg_starts = [s["start"] for s in segments]
    out_measures = []
    prev_chord = None
    for m in measures:
        first = m["beat"] * SLOTS_PER_BEAT
        lines = [""] * n_strings
        chord_line = ""
        for j in range(m["beats"] * SLOTS_PER_BEAT):
            slot = first + j
            frets = {s: str(f) for s, f in fingered.get(slot, ())}
            width = max((len(v) for v in frets.values()), default=1)
            col = len(lines[0])

            chord = chord_at(segments, seg_starts, slot_time(slot, beats, period))
            if chord != "N" and (j == 0 or chord != prev_chord) and len(chord_line) <= col:
                chord_line = chord_line.ljust(col) + transpose_name(chord, chord_shift, flats) + " "
            prev_chord = chord

            for s in range(n_strings):
                v = frets.get(s, "")
                # A hammer-on, pull-off or slide is written just before the note it leads into.
                lines[s] += v + "-" * (width - len(v)) + marks.get((slot + 1, s), "-")
        width = len(lines[0]) + 1
        out_measures.append({
            "beat": m["beat"],
            "chords": chord_line.rstrip().ljust(width),
            "strings": [s + "|" for s in lines],
        })

    return {
        "tuning": " ".join(FLATS[p % 12] for p in strings),
        "string_names": string_names(strings),
        "capo": capo,
        "note_count": len(notes),
        "measures": out_measures,
    }
