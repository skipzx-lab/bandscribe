// Chord naming, transposition and guitar chord diagrams.
const Chords = (() => {
  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
  const RE = /^([A-G])([#b]?)(.*?)(?:\/([A-G][#b]?))?$/;

  function pc(note) {
    let i = SHARPS.indexOf(note);
    if (i < 0) i = FLATS.indexOf(note);
    return i;
  }

  function parse(name) {
    const m = RE.exec(name || "");
    if (!m) return null;
    return { root: pc(m[1] + m[2]), quality: m[3], bass: m[4] ? pc(m[4]) : null };
  }

  function keyUsesFlats(tonicPc, mode) {
    const major = mode === "minor" ? (tonicPc + 3) % 12 : tonicPc;
    return FLAT_MAJOR.has(major);
  }

  function transpose(name, semis, flats) {
    if (!semis || name === "N") return name;
    const p = parse(name);
    if (!p) return name;
    const names = flats ? FLATS : SHARPS;
    const r = names[(p.root + semis + 120) % 12];
    const b = p.bass == null ? "" : "/" + names[(p.bass + semis + 120) % 12];
    return r + p.quality + b;
  }

  // Frets low E -> high e; -1 = muted.
  const OPEN = {
    "C": [-1, 3, 2, 0, 1, 0], "D": [-1, -1, 0, 2, 3, 2], "E": [0, 2, 2, 1, 0, 0], "G": [3, 2, 0, 0, 0, 3],
    "A": [-1, 0, 2, 2, 2, 0], "Am": [-1, 0, 2, 2, 1, 0], "Em": [0, 2, 2, 0, 0, 0], "Dm": [-1, -1, 0, 2, 3, 1],
    "E7": [0, 2, 0, 1, 0, 0], "A7": [-1, 0, 2, 0, 2, 0], "D7": [-1, -1, 0, 2, 1, 2], "G7": [3, 2, 0, 0, 0, 1],
    "C7": [-1, 3, 2, 3, 1, 0], "B7": [-1, 2, 1, 2, 0, 2], "Am7": [-1, 0, 2, 0, 1, 0], "Em7": [0, 2, 0, 0, 0, 0],
    "Dm7": [-1, -1, 0, 2, 1, 1], "Cmaj7": [-1, 3, 2, 0, 0, 0], "Fmaj7": [-1, -1, 3, 2, 1, 0],
    "Amaj7": [-1, 0, 2, 1, 2, 0], "Dmaj7": [-1, -1, 0, 2, 2, 2], "Gmaj7": [3, 2, 0, 0, 0, 2],
    "Asus2": [-1, 0, 2, 2, 0, 0], "Asus4": [-1, 0, 2, 2, 3, 0], "Dsus2": [-1, -1, 0, 2, 3, 0],
    "Dsus4": [-1, -1, 0, 2, 3, 3], "Esus4": [0, 2, 2, 2, 0, 0], "Csus2": [-1, 3, 0, 0, 1, 0],
    "Gsus4": [3, 3, 0, 0, 1, 3], "Csus4": [-1, 3, 3, 0, 1, 1],
    "Gsus2": [3, 0, 0, 2, 3, 3], "Esus2": [0, 2, 4, 4, 0, 0], "Cadd9": [-1, 3, 2, 0, 3, 0],
    "Gadd9": [3, 0, 0, 2, 0, 3], "Dadd9": [-1, -1, 0, 2, 3, 0], "Em9": [0, 2, 0, 0, 0, 2],
    "Bm7": [-1, 2, 0, 2, 0, 2], "F#m7": [2, 4, 2, 2, 2, 2], "E9": [0, 2, 0, 1, 0, 2],
    "Asus2/G": [3, 0, 2, 2, 0, 0], "D/F#": [2, 0, 0, 2, 3, 2], "C/G": [3, 3, 2, 0, 1, 0], "G/B": [-1, 2, 0, 0, 0, 3],
    // standard barre shapes
    "F": [1, 3, 3, 2, 1, 1], "Fm": [1, 3, 3, 1, 1, 1], "F#": [2, 4, 4, 3, 2, 2], "F#m": [2, 4, 4, 2, 2, 2],
    "Gm": [3, 5, 5, 3, 3, 3], "G#": [4, 6, 6, 5, 4, 4], "G#m": [4, 6, 6, 4, 4, 4],
    "A#": [-1, 1, 3, 3, 3, 1], "A#m": [-1, 1, 3, 3, 2, 1], "B": [-1, 2, 4, 4, 4, 2], "Bm": [-1, 2, 4, 4, 3, 2],
    "Cm": [-1, 3, 5, 5, 4, 3], "C#": [-1, 4, 6, 6, 6, 4], "C#m": [-1, 4, 6, 6, 5, 4],
    "D#": [-1, 6, 8, 8, 8, 6], "D#m": [-1, 6, 8, 8, 7, 6], "Fmaj7": [-1, -1, 3, 2, 1, 0],
  };
  // Only the plain open shapes count as "open" when suggesting a tuning.
  const BARRE = new Set(["F", "Fm", "F#", "F#m", "Gm", "G#", "G#m", "A#", "A#m", "B", "Bm", "Cm", "C#", "C#m", "D#", "D#m", "F#m7"]);

  const STANDARD = [40, 45, 50, 55, 59, 64];
  const INTERVALS = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "sus2": [0, 2, 7], "sus4": [0, 5, 7], "7sus4": [0, 5, 7, 10], "dim": [0, 3, 6], "dim7": [0, 3, 6, 9],
    "m7b5": [0, 3, 6, 10], "aug": [0, 4, 8], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "add9": [0, 4, 7, 2],
    "9": [0, 4, 7, 10, 2], "m9": [0, 3, 7, 10, 2], "5": [0, 7],
  };

  // Search every playable fingering in each 4-fret window and keep the easiest-looking one.
  function searchVoicing(p, strings, needBass) {
    const ivs = INTERVALS[p.quality];
    if (!ivs) return null;
    const tones = new Set(ivs.map(i => (p.root + i) % 12));
    const required = new Set(ivs.filter(i => i !== 7).map(i => (p.root + i) % 12)); // the 5th may be dropped
    const bass = p.bass ?? p.root;
    if (p.bass != null) tones.add(p.bass);
    let best = null;

    for (let base = 0; base <= 9; base++) {
      const lo = Math.max(base, 1), hi = base + 3;
      const opts = strings.map(open => {
        const o = [-1];
        if (tones.has(open % 12)) o.push(0);
        for (let f = lo; f <= hi; f++) if (tones.has((open + f) % 12)) o.push(f);
        return o;
      });
      const n = strings.length;
      const frets = new Array(n);
      const walk = i => {
        if (i < n) { for (const f of opts[i]) { frets[i] = f; walk(i + 1); } return; }
        const score = rate(frets, strings, tones, required, needBass ? bass : null);
        if (score != null && (!best || score < best.score)) best = { score, frets: [...frets] };
      };
      walk(0);
    }
    return best && best.frets;
  }

  // `bass`: required lowest pitch class, or null for re-entrant tunings like ukulele.
  function rate(frets, strings, tones, required, bass) {
    const played = frets.map((f, i) => (f >= 0 ? i : -1)).filter(i => i >= 0);
    if (played.length < Math.min(4, strings.length)) return null;
    const first = played[0], last = played[played.length - 1];
    if (bass != null && ((strings[first] + frets[first]) % 12 !== bass || first > 2)) return null;
    const present = new Set(played.map(i => (strings[i] + frets[i]) % 12));
    for (const t of required) if (!present.has(t)) return null;
    const gaps = last - first + 1 - played.length;
    if (gaps > 1) return null;

    const fretted = played.filter(i => frets[i] > 0);
    const opens = played.length - fretted.length;
    let fingers = fretted.length, barre = false;
    if (fingers > 4) {
      // Barre the lowest fret: it must cover every string from where it starts, with no open strings above.
      const min = Math.min(...fretted.map(i => frets[i]));
      const barreFrom = fretted.find(i => frets[i] === min);
      if (played.some(i => i > barreFrom && frets[i] === 0)) return null;
      fingers = fretted.filter(i => frets[i] > min).length + 1;
      barre = true;
      if (fingers > 4) return null;
    }
    const fs = fretted.map(i => frets[i]);
    const minFret = fs.length ? Math.min(...fs) : 0;
    const span = fs.length ? Math.max(...fs) - minFret : 0;
    // Open strings ringing between notes high up the neck are rarely how a chord is played.
    const awkwardOpens = played.filter(i => frets[i] === 0 && i > first && i < last && Math.max(...fs) >= 4).length;
    const missingFifth = tones.size > present.size ? 0.4 : 0;
    return minFret * 1.2 - played.length * 0.8 - opens * 0.15 + fingers * 0.3 + span * 0.5
      + awkwardOpens * 1.5 + (barre ? 1.5 : 0) + gaps * 2 + missingFifth;
  }

  // `strings`: open-string pitches (low to high) relative to the shapes being named.
  // `needBass`: the chord's root (or slash bass) must be the lowest note played.
  function voicing(name, strings = STANDARD, needBass = true) {
    const p = parse(name);
    if (!p) return null;
    const standard = strings.every((s, i) => s === STANDARD[i]);
    if (standard && p.bass == null) {
      const known = OPEN[SHARPS[p.root] + p.quality] || OPEN[FLATS[p.root] + p.quality];
      if (known) return known;
    }
    return searchVoicing(p, strings, needBass);
  }

  // Plain major/minor version of a chord: Gsus2 -> G, Dmaj7 -> D, Bm7 -> Bm, F#dim -> F#m.
  function simplify(name) {
    const p = parse(name);
    if (!p || name === "N") return name;
    const minor = /^(m(?!aj)|dim|m7b5)/.test(p.quality);
    return name.match(/^[A-G][#b]?/)[0] + (minor ? "m" : "");
  }

  function diagramSVG(name, strings, needBass = true) {
    const frets = voicing(name, strings, needBass);
    const n = (strings || STANDARD).length;
    const W = 100, H = 120, sw = 13, fh = 18, rows = 5, y0 = 24;
    const x0 = Math.round((W - (n - 1) * sw) / 2) - 3;
    if (!frets) {
      return `<svg viewBox="0 0 ${W} ${H}"><text x="50" y="65" text-anchor="middle" fill="#8b93a7" font-size="11">no shape</text></svg>`;
    }
    const played = frets.filter(f => f > 0);
    const maxF = played.length ? Math.max(...played) : 0;
    const base = maxF > rows ? Math.min(...played) : 1;
    let s = `<svg viewBox="0 0 ${W} ${H}" font-family="JetBrains Mono, monospace">`;
    const stroke = "#8b93a7";
    for (let i = 0; i < n; i++) s += `<line x1="${x0 + i * sw}" y1="${y0}" x2="${x0 + i * sw}" y2="${y0 + rows * fh}" stroke="${stroke}" stroke-width="1"/>`;
    for (let j = 0; j <= rows; j++) {
      const w = j === 0 && base === 1 ? 3 : 1;
      s += `<line x1="${x0}" y1="${y0 + j * fh}" x2="${x0 + (n - 1) * sw}" y2="${y0 + j * fh}" stroke="${stroke}" stroke-width="${w}"/>`;
    }
    if (base > 1) s += `<text x="${x0 + (n - 1) * sw + 6}" y="${y0 + fh * 0.7}" fill="#e7e9ee" font-size="10">${base}fr</text>`;
    // Barre: more than four fretted notes means the lowest fret is held with one finger across.
    if (played.length > 4 || (n === 4 && played.length === 4)) {
      const min = Math.min(...played);
      const from = frets.findIndex(f => f === min), to = frets.lastIndexOf(min);
      if (to > from) {
        const y = y0 + (min - base + 0.5) * fh;
        s += `<rect x="${x0 + from * sw - 5}" y="${y - 5}" width="${(to - from) * sw + 10}" height="10" rx="5" fill="#f5b942"/>`;
      }
    }
    frets.forEach((f, i) => {
      const x = x0 + i * sw;
      if (f < 0) s += `<text x="${x}" y="${y0 - 7}" text-anchor="middle" fill="${stroke}" font-size="10">×</text>`;
      else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 10}" r="3.5" fill="none" stroke="#e7e9ee"/>`;
      else s += `<circle cx="${x}" cy="${y0 + (f - base + 0.5) * fh}" r="5" fill="#f5b942"/>`;
    });
    return s + "</svg>";
  }

  // Pitch classes of a chord, root first (slash bass excluded).
  function tones(name) {
    const p = parse(name);
    const ivs = p && INTERVALS[p.quality];
    return ivs ? ivs.map(i => (p.root + i) % 12) : [];
  }

  // A two-handed piano voicing: root in the left hand (C2-B2 octave above it, i.e. MIDI 48-59)
  // and the chord in the right hand near middle C, choosing the inversion that moves least
  // from `prev` (the previous right-hand notes) so changes stay smooth.
  function pianoVoicing(name, prev) {
    const pcs = tones(name);
    if (!pcs.length) return null;
    const p = parse(name);
    const left = 48 + (p.bass ?? p.root);
    let best = null;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      for (const start of [55, 60]) {
        const notes = [];
        let n = start - 1;
        for (const pc of order) {
          n += 1;
          while (n % 12 !== pc) n++;
          notes.push(n);
        }
        if (notes[notes.length - 1] > 79) continue;
        const center = notes.reduce((a, b) => a + b, 0) / notes.length;
        const cost = prev && prev.length
          ? Math.abs(center - prev.reduce((a, b) => a + b, 0) / prev.length)
          : Math.abs(center - 64);
        if (!best || cost < best.cost) best = { cost, right: notes };
      }
    }
    return { left, right: best.right };
  }

  const BLACK = new Set([1, 3, 6, 8, 10]);

  // Keyboard SVG covering MIDI lo..hi; every key has data-p="<midi>" so it can be lit later.
  function keyboardSVG(lo, hi, { height = 70, labels = true } = {}) {
    const whites = [];
    for (let p = lo; p <= hi; p++) if (!BLACK.has(p % 12)) whites.push(p);
    const ww = 14, W = whites.length * ww;
    let s = `<svg class="kbd" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none">`;
    whites.forEach((p, i) => {
      s += `<rect class="key white" data-p="${p}" x="${i * ww}" y="0" width="${ww}" height="${height}" rx="2"/>`;
      if (labels && p % 12 === 0) s += `<text x="${i * ww + ww / 2}" y="${height - 5}" text-anchor="middle" class="klabel">C${Math.floor(p / 12) - 1}</text>`;
    });
    for (let p = lo; p <= hi; p++) {
      if (!BLACK.has(p % 12)) continue;
      const i = whites.indexOf(p - 1);
      s += `<rect class="key black" data-p="${p}" x="${(i + 1) * ww - ww * 0.32}" y="0" width="${ww * 0.64}" height="${height * 0.62}" rx="1.5"/>`;
    }
    return s + "</svg>";
  }

  // Small keyboard diagram for the Chords view: two octaves with the chord lit.
  function pianoSVG(name) {
    const v = pianoVoicing(name);
    if (!v) return `<svg viewBox="0 0 100 60"><text x="50" y="35" text-anchor="middle" fill="#8b93a7" font-size="11">no shape</text></svg>`;
    const lowest = Math.min(...v.right);
    const base = lowest - (lowest % 12); // the C at or below the chord
    const s = keyboardSVG(base, base + 23, { height: 60, labels: false });
    const lit = new Set(v.right);
    const root = parse(name).root;
    return s.replace(/data-p="(\d+)"/g, (m, p) => {
      const n = +p;
      if (!lit.has(n)) return m;
      return `${m} data-on="${n % 12 === root ? "root" : "on"}"`;
    });
  }

  // True when the chord has a common open-position shape (C, G, D, Am, Em7, Dsus4, ...).
  function isOpenShape(name) {
    const p = parse(name);
    const key = SHARPS[p?.root] + p?.quality;
    return !!p && p.bass == null && key in OPEN && !BARRE.has(key);
  }

  return {
    SHARPS, FLATS, parse, pc, transpose, keyUsesFlats, diagramSVG, isOpenShape, simplify, voicing,
    tones, pianoVoicing, keyboardSVG, pianoSVG,
  };
})();
