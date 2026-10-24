// Bandscribe frontend: library, progress, and the song view (sheet / tab / chords / lyrics).
const app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const store = {
  get(k, d) {
    try {
      // "chordy." keys are from before the rename
      const v = localStorage.getItem("bandscribe." + k) ?? localStorage.getItem("chordy." + k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem("bandscribe." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

async function json(res) {
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

const api = {
  list: () => fetch("/api/jobs").then(json),
  get: id => fetch(`/api/jobs/${id}`).then(json),
  upload(file, opts) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("whisper_model", opts.whisper_model);
    fd.append("language", opts.language);
    return fetch("/api/jobs", { method: "POST", body: fd }).then(json);
  },
  rename: (id, title) => fetch(`/api/jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then(json),
  upgrade: id => fetch(`/api/jobs/${id}/parts`, { method: "POST" }).then(json),
  lows: id => fetch(`/api/jobs/${id}/lows`).then(json),
  lyrics: (id, text) => fetch(`/api/jobs/${id}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(json),
  tuning: (id, body) => fetch(`/api/jobs/${id}/tuning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
  save: (id, result) => fetch(`/api/jobs/${id}/result`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) }).then(json),
  del: id => fetch(`/api/jobs/${id}`, { method: "DELETE" }).then(json),
  retry: id => fetch(`/api/jobs/${id}/retry`, { method: "POST" }).then(json),
};

const STAGES = [
  ["prepare", "Decoding audio"],
  ["separate", "Separating instruments"],
  ["rhythm", "Finding the beat"],
  ["chords", "Detecting chords"],
  ["lyrics", "Transcribing lyrics"],
  ["parts", "Transcribing each instrument"],
  ["finish", "Encoding audio"],
];
// Open-string MIDI pitches, low to high
const STANDARD = [40, 45, 50, 55, 59, 64];
const TUNINGS = [
  ["Standard", STANDARD],
  ["Half step down", STANDARD.map(p => p - 1)],
  ["Whole step down", STANDARD.map(p => p - 2)],
  ["Drop D", [38, 45, 50, 55, 59, 64]],
  ["Drop Db", [37, 44, 49, 54, 58, 63]],
  ["Drop C", [36, 43, 48, 53, 57, 62]],
  ["DADGAD", [38, 45, 50, 55, 57, 62]],
  ["Open G", [38, 43, 50, 55, 59, 62]],
  ["Open D", [38, 45, 50, 54, 57, 62]],
];
// How far the chord shapes sit from the sounding pitch: the A string is the reference.
const tuningShift = strings => strings[1] - STANDARD[1];
// The drop version of each uniform tuning, and older names for the same tunings.
const DROPS = { "Standard": "Drop D", "Half step down": "Drop Db", "Whole step down": "Drop C" };
const TUNING_ALIASES = { "Drop C#": "Drop Db" };
const isUniformShift = strings => strings.every((p, i) => p - STANDARD[i] === strings[0] - STANDARD[0]);
const UKULELE = [67, 60, 64, 69]; // G C E A (re-entrant)
const PART_VIEWS = [["guitar", "Guitar tab"], ["bass", "Bass tab"], ["piano", "Piano"], ["drums", "Drums"], ["melody", "Melody"]];
const TAB_VIEWS = ["guitar", "bass", "drums"];
const ROLL_VIEWS = ["piano", "melody"];
const STEM_LABELS = { mix: "Full mix", vocals: "Vocals only", guitar: "Guitar", bass: "Bass", piano: "Piano / keys", drums: "Drums", other: "Other" };

let timers = [];
let cleanupFns = [];
function cleanup() {
  timers.forEach(clearTimeout);
  timers = [];
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
}

function route() {
  cleanup();
  const m = location.hash.match(/^#\/job\/(\w+)/);
  if (m) showJob(m[1]); else showLibrary();
}
window.addEventListener("hashchange", route);
route();

/* ---------------- Library ---------------- */

function showLibrary() {
  const opts = store.get("opts", { whisper_model: "small", language: "" });
  app.innerHTML = `
    <section class="drop" id="drop">
      <h2>Drop a song here</h2>
      <p>MP3, WAV, FLAC, M4A, video files, or record from your microphone. Everything runs on this PC.</p>
      <input type="file" id="file" accept="audio/*,video/*" hidden>
      <button class="primary" id="pick">Choose file</button>
      <button id="rec">🎙 Record</button>
      <div class="options">
        <label>Lyrics quality
          <select id="wm">
            <option value="small">Fast (small)</option>
            <option value="medium">Better (medium)</option>
            <option value="large-v3-turbo">Best (large-v3-turbo)</option>
          </select>
        </label>
        <label>Language
          <select id="lang">
            <option value="">Auto-detect</option>
            ${["en English", "es Spanish", "fr French", "de German", "it Italian", "pt Portuguese", "nl Dutch", "sv Swedish", "ja Japanese", "ko Korean", "zh Chinese"]
              .map(s => `<option value="${s.slice(0, 2)}">${s.slice(3)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p id="status" style="margin:14px 0 0"></p>
    </section>
    <div class="jobs" id="jobs"></div>`;

  const drop = app.querySelector("#drop");
  const fileInput = app.querySelector("#file");
  const wm = app.querySelector("#wm");
  const lang = app.querySelector("#lang");
  const status = app.querySelector("#status");
  wm.value = opts.whisper_model;
  lang.value = opts.language;
  const currentOpts = () => {
    const o = { whisper_model: wm.value, language: lang.value };
    store.set("opts", o);
    return o;
  };

  async function upload(file) {
    status.textContent = `Uploading ${file.name}…`;
    try {
      const meta = await api.upload(file, currentOpts());
      location.hash = `#/job/${meta.id}`;
    } catch (e) {
      status.textContent = `Upload failed: ${e.message}`;
    }
  }

  app.querySelector("#pick").onclick = () => fileInput.click();
  fileInput.onchange = () => fileInput.files[0] && upload(fileInput.files[0]);
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) upload(f);
  });

  // Microphone recording
  const recBtn = app.querySelector("#rec");
  let recorder = null;
  recBtn.onclick = async () => {
    if (recorder) { recorder.stop(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      status.textContent = `Microphone unavailable: ${e.message}`;
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      recorder = null;
      clearInterval(tick);
      recBtn.innerHTML = "🎙 Record";
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      upload(new File(chunks, `Recording ${stamp}.webm`, { type: "audio/webm" }));
    };
    recorder.start();
    const t0 = Date.now();
    const tick = setInterval(() => { recBtn.innerHTML = `<span class="rec-dot"></span>Stop (${fmtTime((Date.now() - t0) / 1000)})`; }, 250);
    cleanupFns.push(() => { if (recorder) { recorder.onstop = null; recorder.stop(); stream.getTracks().forEach(t => t.stop()); clearInterval(tick); } });
  };

  refreshList();
}

async function refreshList() {
  const el = document.getElementById("jobs");
  if (!el) return;
  let jobs;
  try { jobs = await api.list(); } catch { return; }
  if (!jobs.length) {
    el.innerHTML = `<p class="empty">No songs yet. Your transcriptions will appear here.</p>`;
    return;
  }
  el.innerHTML = jobs.map(j => {
    const busy = j.status === "running" || j.status === "queued";
    return `<a class="job" href="#/job/${j.id}">
      <span class="title">${esc(j.title)}</span>
      ${busy ? `<span class="meta">${esc(j.stage_label || "")}</span><span class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></span>` : ""}
      <span class="badge ${j.status}">${j.status === "done" ? "ready" : j.status}</span>
      <span class="meta">${new Date(j.created * 1000).toLocaleDateString()}</span>
      <button class="danger" data-del="${j.id}" ${j.status === "running" ? "disabled" : ""}>Delete</button>
    </a>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.armed) {
        await api.del(btn.dataset.del).catch(() => {});
        refreshList();
      } else {
        btn.dataset.armed = "1";
        btn.textContent = "Confirm?";
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete"; }, 3000);
      }
    };
  });
  if (jobs.some(j => j.status === "running" || j.status === "queued")) {
    timers.push(setTimeout(refreshList, 2000));
  }
}

/* ---------------- Job / progress ---------------- */

async function showJob(id) {
  let job;
  try { job = await api.get(id); } catch (e) {
    app.innerHTML = `<p class="empty">Couldn't load this song: ${esc(e.message)}. <a href="#/">Back</a></p>`;
    return;
  }
  if (job.status === "done" && job.result) showSong(job);
  else showProgress(job);
}

function showProgress(job) {
  const idx = STAGES.findIndex(([id]) => id === job.stage);
  const failed = job.status === "error";
  app.innerHTML = `
    <div class="progress-card">
      <h2 style="margin:0">${esc(job.title)}</h2>
      <p class="facts" style="margin:6px 0 0">${failed ? "Processing failed" : job.status === "queued" && idx < 0 ? "Waiting in queue…" : esc(job.stage_label || "")}</p>
      <div class="bar bigbar"><i style="width:${Math.round((job.progress || 0) * 100)}%"></i></div>
      <ul class="stages">
        ${STAGES.map(([id, label], i) => `<li class="${i < idx ? "done" : i === idx ? (failed ? "failed" : "active") : ""}">${label}</li>`).join("")}
      </ul>
      ${failed ? `<p class="error-box">${esc(job.error || "Unknown error")}</p><button class="primary" id="retry">Retry</button>` : ""}
      <p class="hint" style="margin-top:18px">The first run downloads the separation and lyrics models, which takes a few extra minutes.</p>
    </div>`;
  if (failed) {
    app.querySelector("#retry").onclick = async () => { await api.retry(job.id); showJob(job.id); };
    return;
  }
  timers.push(setTimeout(async () => {
    try { job = await api.get(job.id); } catch { /* transient */ }
    if (job.status === "done" && job.result) showSong(job); else showProgress(job);
  }, 1500));
}

/* ---------------- Song view ---------------- */

function showSong(job) {
  const r = job.result;
  const id = job.id;
  const origTonic = Chords.pc(r.key.tonic);
  const origFlats = Chords.keyUsesFlats(origTonic, r.key.mode);
  const st = {
    semis: store.get(`semis.${id}`, 0),
    view: store.get("view", "sheet"),
    follow: store.get("follow", true),
    simple: store.get("simple", false),
    keys: store.get("keys", false),
    instr: store.get("instr", "guitar"),
    stem: "mix",
  };
  if (!r.parts && r.tab) r.parts = { guitar: r.tab }; // songs from before parts existed
  r.parts ||= {};
  if (st.view === "tab") st.view = "guitar";
  const VIEWS = ["sheet", ...PART_VIEWS.map(([k]) => k).filter(k => r.parts[k]), "chords", "lyrics"];
  if (!VIEWS.includes(st.view)) st.view = "sheet";

  r.tuning ||= { name: "Standard", strings: STANDARD, capo: 0 };

  // Chord names show the shapes you play: sounding pitch (+ key transpose) minus tuning and capo.
  const offset = () => st.semis - tuningShift(r.tuning.strings) - r.tuning.capo;
  const spell = (name, semis) => {
    if (name === "N") return "N.C.";
    if (!semis) return name;
    return Chords.transpose(name, semis, Chords.keyUsesFlats((origTonic + semis + 120) % 12, r.key.mode));
  };
  const show = name => spell(st.simple ? Chords.simplify(name) : name, offset());
  // Pianos and ukuleles aren't tuned down with the guitar: they read the sounding chord (plus transpose).
  const concert = name => spell(st.simple ? Chords.simplify(name) : name, st.semis);
  // Open strings relative to the shapes being named (a half-step-down guitar plays standard shapes).
  const shapeStrings = () => r.tuning.strings.map(p => p - tuningShift(r.tuning.strings));
  const keyName = () => {
    const sounding = `${spell(r.key.tonic, st.semis)} ${r.key.mode}`;
    return offset() === st.semis ? sounding : `${sounding} · shapes in ${show(r.key.tonic)}`;
  };

  // Measure start/end times
  const beatTime = i => (i < r.beats.length ? r.beats[i] : r.duration);
  const measures = r.measures.map((m, i) => ({ ...m, i, start: beatTime(m.beat), end: beatTime(m.beat + m.beats) }));

  const segStarts = () => r.chords.map(s => s.start);
  function segIndexAt(t) {
    const starts = segStarts();
    let lo = 0, hi = starts.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  const chordAt = t => (r.chords.length ? r.chords[segIndexAt(t)].chord : "N");

  function measureChords(m) {
    const out = [];
    for (const s of r.chords) {
      if (s.end <= m.start + 0.05 || s.start >= m.end - 0.05) continue;
      if (!out.length || show(out[out.length - 1]) !== show(s.chord)) out.push(s.chord);
    }
    return out;
  }

  app.innerHTML = `
    <div class="song-head">
      <h1 contenteditable="true" spellcheck="false" id="title">${esc(job.title)}</h1>
      <div class="facts">
        <span>Key <b id="key"></b></span>
        <span>Tempo <b>${Math.round(r.tempo)} BPM</b></span>
        <span>Length <b>${fmtTime(r.duration)}</b></span>
      </div>
    </div>
    <div class="player">
      <div class="now"><span class="cur" id="cur">–</span><span class="nxt" id="nxt"></span></div>
      <audio id="audio" controls preload="auto" src="/api/jobs/${id}/audio/mix"></audio>
      <div class="controls">
        <select id="stem" title="What to listen to">
          ${["mix", ...r.stems].map(s => `<option value="${s}">${STEM_LABELS[s] || s}</option>`).join("")}
        </select>
        <select id="tuning" title="Your guitar's tuning: chord names, diagrams and tab follow it">
          ${TUNINGS.map(([n]) => `<option>${n}</option>`).join("")}
        </select>
        <select id="capo" title="Capo">
          ${Array.from({ length: 10 }, (_, c) => `<option value="${c}">${c ? `Capo ${c}` : "No capo"}</option>`).join("")}
        </select>
        <div class="transpose" title="Transpose to another key (resets when you change tuning or capo)">
          <button id="down">−</button><span id="semis"></span><button id="up">+</button>
        </div>
        <label title="Show plain major/minor chords (Gsus2 → G, Dmaj7 → D)"><input type="checkbox" id="simple"> Simple chords</label>
        <label title="Keep the current line in view while playing (pauses briefly when you scroll yourself)"><input type="checkbox" id="follow"> Auto-scroll</label>
        <button id="keysBtn" title="Live keyboard: the current chord to play, the next one, and the piano track's notes">🎹 Keyboard</button>
        <button id="export">Export .txt</button>
        <a class="button" href="/api/jobs/${id}/midi/all" download title="Every part as one MIDI file">MIDI</a>
        <button id="print">Print</button>
      </div>
      <div id="kbd" class="kbd-wrap" hidden></div>
    </div>
    <div id="upgrade"></div>
    <div id="suggest"></div>
    <nav class="tabs">
      <button data-view="sheet">Chord sheet</button>
      ${PART_VIEWS.filter(([k]) => r.parts[k]).map(([k, label]) => `<button data-view="${k}">${label}</button>`).join("")}
      <button data-view="chords">Chords</button>
      <button data-view="lyrics">Lyrics</button>
    </nav>
    <section id="view"></section>`;

  const audio = app.querySelector("#audio");
  const view = app.querySelector("#view");
  const curEl = app.querySelector("#cur");
  const nxtEl = app.querySelector("#nxt");

  const titleEl = app.querySelector("#title");
  titleEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); } });
  titleEl.addEventListener("blur", () => {
    const t = titleEl.textContent.trim();
    if (t && t !== job.title) { job.title = t; api.rename(id, t).catch(() => {}); }
  });

  // Audio source switching keeps position
  app.querySelector("#stem").onchange = e => {
    const t = audio.currentTime, playing = !audio.paused;
    audio.src = `/api/jobs/${id}/audio/${e.target.value}`;
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; if (playing) audio.play(); }, { once: true });
  };

  function updateHeader() {
    app.querySelector("#key").textContent = keyName();
    app.querySelector("#semis").textContent = st.semis ? (st.semis > 0 ? `+${st.semis}` : st.semis) : "0";
  }
  const setSemis = d => {
    st.semis = ((st.semis + d + 17) % 12) - 5; // keep within -5..+6
    store.set(`semis.${id}`, st.semis);
    updateHeader();
    render();
  };
  app.querySelector("#down").onclick = () => setSemis(-1);
  app.querySelector("#up").onclick = () => setSemis(1);

  // Tuning and capo: the server re-frets the tab, the page re-labels chords as shapes.
  const tuningSel = app.querySelector("#tuning");
  const capoSel = app.querySelector("#capo");
  const syncTuningControls = () => {
    r.tuning.name = TUNING_ALIASES[r.tuning.name] || r.tuning.name;
    if (!TUNINGS.some(([n]) => n === r.tuning.name)) tuningSel.add(new Option(r.tuning.name));
    tuningSel.value = r.tuning.name;
    capoSel.value = String(r.tuning.capo);
  };
  async function setTuning(name, capo) {
    const strings = (TUNINGS.find(([n]) => n === name) || [name, r.tuning.strings])[1];
    tuningSel.disabled = capoSel.disabled = true;
    try {
      const res = await api.tuning(id, { name, strings, capo });
      r.parts = res.parts;
      r.tuning = res.tuning;
      // A key transpose was usually standing in for the tuning, so it would now count twice.
      st.semis = 0;
      store.set(`semis.${id}`, 0);
    } catch (e) {
      console.warn("retune failed", e);
    }
    tuningSel.disabled = capoSel.disabled = false;
    syncTuningControls();
    updateHeader();
    renderSuggestion();
    render();
  }
  tuningSel.onchange = () => setTuning(tuningSel.value, +capoSel.value);
  capoSel.onchange = () => setTuning(tuningSel.value, +capoSel.value);

  // Suggest a down-tuning when the chords would then be open shapes (e.g. Db -> D on Eb tuning),
  // and its drop version when the guitar keeps playing a note a tone below the lowest string.
  let lows = null;
  const lower = name => name[0].toLowerCase() + name.slice(1); // "Drop Db" -> "drop Db"
  async function renderSuggestion() {
    const box = app.querySelector("#suggest");
    box.innerHTML = "";
    if (store.get(`tuneHintOff.${id}`, false)) return;
    const total = r.chords.reduce((a, s) => a + (s.chord === "N" ? 0 : s.end - s.start), 0);
    if (!total) return;
    const fit = strings => {
      const o = -tuningShift(strings) - r.tuning.capo;
      let open = 0;
      for (const s of r.chords) if (s.chord !== "N" && Chords.isOpenShape(spell(s.chord, o))) open += s.end - s.start;
      return open / total;
    };
    const current = fit(r.tuning.strings);
    const uniform = TUNINGS.slice(0, 3);
    let [family, familyStrings] = uniform.reduce((best, t) => (fit(t[1]) > fit(best[1]) ? t : best), uniform[0]);
    if (fit(familyStrings) < current + 0.2) {
      // Keep the current chord shapes; only the low string can still change.
      const same = uniform.find(([, st]) => tuningShift(st) === tuningShift(r.tuning.strings));
      if (!same) return;
      [family, familyStrings] = same;
    }
    if (!lows && r.parts?.guitar) lows = await api.lows(id).catch(() => ({ total: 0, lows: {} }));
    const dropNote = familyStrings[0] - 2;
    const dropSecs = lows?.lows?.[dropNote] || 0;
    const dropped = dropSecs >= 4 && dropSecs >= 0.02 * lows.total;
    const [name, strings] = dropped ? TUNINGS.find(([n]) => n === DROPS[family]) : [family, familyStrings];
    // Never talk someone out of a drop tuning they picked.
    if (name === r.tuning.name || (!dropped && DROPS[name] === r.tuning.name)) return;
    const o = -tuningShift(strings) - r.tuning.capo;
    const sample = [...new Set(r.chords.filter(s => s.chord !== "N").map(s => spell(s.chord, o)))].slice(0, 5).join(", ");
    const shapes = family === r.tuning.name || tuningShift(strings) === tuningShift(r.tuning.strings) ? ""
      : `These chords look like open shapes on a guitar tuned <b>${lower(family)}</b> (${sample}…):
         ${Math.round(fit(strings) * 100)}% open shapes, versus ${Math.round(current * 100)}% in ${lower(r.tuning.name)}. `;
    const drop = dropped
      ? `The guitar plays a low ${Chords.FLATS[dropNote % 12]} for ${Math.round(dropSecs)}s, a tone below the
         lowest string of ${lower(family)}, so the low string looks dropped: <b>${lower(name)}</b>.`
      : "";
    box.innerHTML = `<div class="suggest">
      <span>${shapes}${drop}</span>
      <button class="primary" id="useTuning">Use ${lower(name)}</button>
      <button id="noTuning">Dismiss</button></div>`;
    box.querySelector("#useTuning").onclick = () => setTuning(name, r.tuning.capo);
    box.querySelector("#noTuning").onclick = () => { store.set(`tuneHintOff.${id}`, true); box.innerHTML = ""; };
  }

  const simpleBox = app.querySelector("#simple");
  simpleBox.checked = st.simple;
  simpleBox.onchange = () => { st.simple = simpleBox.checked; store.set("simple", st.simple); lastChordName = null; render(); };

  const followBox = app.querySelector("#follow");
  followBox.checked = st.follow;
  followBox.onchange = () => { st.follow = followBox.checked; store.set("follow", st.follow); };
  app.querySelector("#print").onclick = () => window.print();
  app.querySelector("#export").onclick = () => exportText();

  const tabBtns = app.querySelectorAll(".tabs button");
  tabBtns.forEach(b => (b.onclick = () => { st.view = b.dataset.view; store.set("view", st.view); render(); }));

  async function persist() {
    try { await api.save(id, r); } catch (e) { console.warn("save failed", e); }
  }

  /* ----- sheet model ----- */

  function blocks() {
    const out = [];
    let cursor = 0;
    const instr = (a, b) => {
      const ms = measures
        .filter(m => m.start >= a - 0.15 && m.end <= b + 0.15)
        .map(m => ({ ...m, chords: measureChords(m) }))
        .filter(m => m.chords.some(c => c !== "N"));
      if (ms.length) out.push({ type: "instr", measures: ms });
    };
    r.lyrics.lines.forEach((ln, li) => {
      instr(cursor, ln.start);
      out.push({ type: "line", line: ln, li, gapBefore: ln.start - cursor });
      cursor = ln.end;
    });
    instr(cursor, r.duration + 1);
    return out;
  }

  function lineChunks(ln) {
    const words = ln.words;
    const slots = words.map(() => []);
    r.chords.forEach((s, si) => {
      if (s.chord === "N" || s.start < ln.start - 0.25 || s.start > ln.end) return;
      if (si > 0 && show(r.chords[si - 1].chord) === show(s.chord)) return; // same once simplified
      let k = words.findIndex(w => w.end > s.start);
      if (k < 0) k = words.length - 1;
      slots[k].push({ name: s.chord, si });
    });
    if (!slots[0].length) {
      const si = segIndexAt(ln.start);
      const c = r.chords[si];
      if (c && c.chord !== "N") slots[0].push({ name: c.chord, si, carry: true });
    }
    return words.map((w, wi) => ({ w, wi, chords: slots[wi] }));
  }

  /* ----- views ----- */

  let words = [];      // [{start, end, el, lineEl}] for follow mode
  let measureEls = []; // [{start, end, els: [...]}]
  let roll = null;     // the piano roll being shown, see renderRoll()

  function render() {
    tabBtns.forEach(b => b.classList.toggle("on", b.dataset.view === st.view));
    words = [];
    measureEls = [];
    lastLine = lastWord = lastChordName = null;
    lastMeasures = [];
    roll = null;
    if (TAB_VIEWS.includes(st.view)) renderTab(st.view);
    else if (ROLL_VIEWS.includes(st.view)) renderRoll(st.view);
    else ({ sheet: renderSheet, chords: renderChords, lyrics: renderLyrics })[st.view]();
    updateKeyboard(audio.currentTime, segIndexAt(audio.currentTime));
    drawRoll();
  }

  function renderSheet() {
    const bl = blocks();
    if (!bl.length) { view.innerHTML = `<p class="empty">No chords or lyrics were detected.</p>`; return; }
    const missing = r.lyrics.reference ? "" : ` · lyrics missing? <a href="#" id="pasteLink">paste the full lyrics</a>`;
    let html = `<p class="hint no-print">Click a word to jump there · click a chord to change it (empty = remove) · click above a word to add a chord · double-click a word to fix the lyric${missing}.</p><div class="sheet">`;
    for (const b of bl) {
      if (b.type === "instr") {
        html += `<div class="instrumental">${b.measures.map(m =>
          `<span class="m" data-mi="${m.i}">${m.chords.map(c => `<b>${esc(show(c))}</b>`).join(" ")}</span>`).join("")}</div>`;
      } else {
        const gap = b.li > 0 && (b.gapBefore > 3 || b.line.stanza) ? ' style="margin-top:22px"' : "";
        if (b.line.section) html += `<div class="section-label">${esc(b.line.section)}</div>`;
        html += `<div class="line" data-li="${b.li}"${b.line.section ? "" : gap}>` + lineChunks(b.line).map(c => {
          const label = c.chords.map(x => esc(show(x.name))).join(" ");
          const carry = c.chords.length && c.chords.every(x => x.carry) ? " carry" : "";
          const si = c.chords.length ? c.chords[0].si : "";
          return `<span class="chunk" data-wi="${c.wi}"><span class="c editable${carry}" data-si="${si}">${label || " "}</span><span class="w">${esc(c.w.text)}</span></span>`;
        }).join("") + `</div>`;
      }
    }
    view.innerHTML = html + "</div>";
    view.querySelector("#pasteLink")?.addEventListener("click", e => {
      e.preventDefault();
      st.view = "lyrics";
      tabBtns.forEach(b => b.classList.toggle("on", b.dataset.view === "lyrics"));
      editLyrics(lyricsText());
    });

    view.querySelectorAll(".line").forEach(lineEl => {
      const ln = r.lyrics.lines[+lineEl.dataset.li];
      lineEl.querySelectorAll(".chunk").forEach(ch => {
        const w = ln.words[+ch.dataset.wi];
        const wEl = ch.querySelector(".w");
        words.push({ start: w.start, end: w.end, el: wEl, lineEl });
        wEl.onclick = () => { audio.currentTime = w.start; };
        wEl.ondblclick = () => editWord(ln, w, wEl);
        ch.querySelector(".c").onclick = e => editChord(e.currentTarget, w);
      });
    });
    view.querySelectorAll(".instrumental .m").forEach(el => {
      const m = measures[+el.dataset.mi];
      measureEls.push({ start: m.start, end: m.end, els: [el] });
      el.onclick = () => { audio.currentTime = m.start; };
    });
    words.sort((a, b) => a.start - b.start);
  }

  function editChord(cEl, word) {
    const si = cEl.dataset.si === "" ? null : +cEl.dataset.si;
    const input = document.createElement("input");
    input.className = "chord-input";
    input.value = cEl.textContent.trim().split(" ")[0];
    cEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      if (commit) applyChordEdit(si, word, input.value.trim());
      render();
    };
    input.onkeydown = e => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); };
    input.onblur = () => finish(true);
  }

  function applyChordEdit(si, word, text) {
    const segs = r.chords;
    let name = text;
    if (/^n\.?c\.?$/i.test(name)) name = "N";
    if (name && name !== "N") {
      if (!Chords.parse(name)) return;
      name = offset() ? Chords.transpose(name, -offset(), origFlats) : name;
    }
    const isCarry = si != null && segs[si] && segs[si].start < word.start - 0.3;

    if (!name) {
      // Remove the chord change: the previous chord continues.
      if (si == null || isCarry) return;
      if (si > 0) { segs[si - 1].end = segs[si].end; segs.splice(si, 1); } else segs[si].chord = "N";
    } else if (si != null && !isCarry) {
      segs[si].chord = name;
    } else {
      // Add a chord change at this word.
      const t = word.start;
      const i = segIndexAt(t);
      const s = segs[i];
      if (Math.abs(s.start - t) < 0.05) s.chord = name;
      else { segs.splice(i + 1, 0, { start: t, end: s.end, chord: name }); s.end = t; }
    }
    for (let i = segs.length - 1; i > 0; i--) {
      if (segs[i].chord === segs[i - 1].chord) { segs[i - 1].end = segs[i].end; segs.splice(i, 1); }
    }
    persist();
  }

  function editWord(ln, w, wEl) {
    wEl.contentEditable = "true";
    wEl.focus();
    document.getSelection().selectAllChildren(wEl);
    wEl.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); wEl.blur(); } };
    wEl.onblur = () => {
      wEl.contentEditable = "false";
      const text = wEl.textContent.trim();
      if (text === w.text) return;
      if (text) w.text = text;
      else {
        ln.words.splice(ln.words.indexOf(w), 1);
        if (!ln.words.length) r.lyrics.lines.splice(r.lyrics.lines.indexOf(ln), 1);
        else { ln.start = ln.words[0].start; ln.end = ln.words[ln.words.length - 1].end; }
      }
      persist();
      render();
    };
  }

  function tabRows(tab, maxChars) {
    const rows = [];
    let row = [], width = 2;
    tab.measures.forEach((m, i) => {
      const w = m.strings[0].length;
      if (row.length && width + w > maxChars) { rows.push(row); row = []; width = 2; }
      row.push({ ...m, i });
      width += w;
    });
    if (row.length) rows.push(row);
    return rows;
  }

  function tabHint(part, tab) {
    const midi = ` · <a href="/api/jobs/${id}/midi/${part}" download>MIDI</a>`;
    if (part === "drums") {
      return `BD kick · SD snare · HH hi-hat · CR crash, one character per 16th note (counted 1 e + a) · ${tab.note_count} hits${midi}. Detected from the drum stem, so ghost notes and toms are left out.`;
    }
    const where = `Transcribed from the <b>${esc(STEM_LABELS[tab.source] || tab.source)}</b> stem`;
    const tuning = `${esc(r.tuning.name[0].toLowerCase() + r.tuning.name.slice(1))} (${tab.tuning})`;
    const legato = "h hammer-on · p pull-off · / \\ slide";
    if (part === "bass") {
      return `${where} · ${tuning} · ${tab.note_count} notes, kept to the bass's usual range · ${legato}${midi}. Check octaves by ear.`;
    }
    return `${where} · ${tuning}${tab.capo ? ` · capo ${tab.capo}, frets counted from the capo` : ""} · ${tab.note_count} notes · ${legato}${st.semis ? " · the tab ignores the key transpose" : ""}${midi}. Automatic tabs are a starting point, so check them by ear.`;
  }

  function renderTab(part) {
    const tab = r.parts[part];
    if (!tab || !tab.measures || !tab.measures.length || !tab.note_count) { view.innerHTML = `<p class="empty">No playable notes were found for this part.</p>`; return; }
    const probe = document.createElement("span");
    probe.className = "tabrow";
    probe.style.cssText = "position:absolute;visibility:hidden";
    probe.textContent = "0".repeat(50);
    view.innerHTML = "";
    view.appendChild(probe);
    const charW = probe.getBoundingClientRect().width / 50 || 8.4;
    probe.remove();
    const maxChars = Math.max(40, Math.floor(view.clientWidth / charW) - 1);

    const pad = " ".repeat(tab.string_names[0].length + 1);
    let html = `<p class="hint">${tabHint(part, tab)}</p><div class="tabwrap">`;
    for (const row of tabRows(tab, maxChars)) {
      html += `<pre class="tabrow"><span class="chordline">${pad}${row.map(m => `<span data-tm="${m.i}">${esc(m.chords)}</span>`).join("")}</span>\n`;
      for (let s = 0; s < tab.string_names.length; s++) {
        html += `${tab.string_names[s]}|${row.map(m => `<span data-tm="${m.i}">${m.strings[s]}</span>`).join("")}\n`;
      }
      html += "</pre>";
    }
    view.innerHTML = html + "</div>";
    const byMeasure = {};
    view.querySelectorAll("[data-tm]").forEach(el => (byMeasure[el.dataset.tm] ||= []).push(el));
    tab.measures.forEach((m, i) => {
      const meas = measures.find(x => x.beat === m.beat);
      if (meas && byMeasure[i]) {
        measureEls.push({ start: meas.start, end: meas.end, els: byMeasure[i] });
        byMeasure[i].forEach(el => (el.onclick = () => { audio.currentTime = meas.start; }));
      }
    });
  }

  function chordColor(name) {
    if (name === "N") return "#22262f";
    const p = Chords.parse(name);
    const hue = p ? (p.root * 30) % 360 : 0;
    const minor = p && /^m(?!aj)/.test(p.quality);
    return `hsl(${hue} ${minor ? 35 : 55}% ${minor ? 30 : 38}%)`;
  }

  // The chord name each instrument reads: guitar shapes follow tuning and capo, the others don't.
  const diagramName = name => (st.instr === "guitar" ? show(name) : concert(name));

  function renderChords() {
    const seen = [];
    for (const s of r.chords) if (s.chord !== "N" && !seen.includes(diagramName(s.chord))) seen.push(diagramName(s.chord));
    if (!seen.length) { view.innerHTML = `<p class="empty">No chords detected.</p>`; return; }
    const draw = {
      guitar: c => Chords.diagramSVG(c, shapeStrings()),
      ukulele: c => Chords.diagramSVG(c, UKULELE, false),
      piano: c => Chords.pianoSVG(c),
    }[st.instr];
    const note = st.instr === "guitar" && !isUniformShift(r.tuning.strings)
      ? `Diagrams are worked out for ${esc(r.tuning.name)}.`
      : st.instr === "guitar" ? "" : "Shown at concert pitch (not affected by guitar tuning or capo).";
    view.innerHTML = `
      <div class="instr-pick">${[["guitar", "Guitar"], ["ukulele", "Ukulele"], ["piano", "Piano"]].map(([k, label]) =>
        `<button data-instr="${k}" class="${st.instr === k ? "on" : ""}">${label}</button>`).join("")}
        <span class="hint" style="margin:0">${note}</span></div>
      <div class="diagrams ${st.instr}">${seen.map(c => `<div class="diagram" data-chord="${esc(c)}"><div class="name">${esc(c)}</div>${draw(c)}</div>`).join("")}</div>
      <div class="timeline">${r.chords.map((s, i) => `<div data-i="${i}" title="${esc(diagramName(s.chord))} @ ${fmtTime(s.start)}" style="flex:${(s.end - s.start).toFixed(2)};background:${chordColor(s.chord)}">${esc(diagramName(s.chord))}</div>`).join("")}</div>`;
    view.querySelectorAll(".timeline div").forEach(el => (el.onclick = () => { audio.currentTime = r.chords[+el.dataset.i].start; }));
    view.querySelectorAll("[data-instr]").forEach(b => (b.onclick = () => {
      st.instr = b.dataset.instr;
      store.set("instr", st.instr);
      lastChordName = null;
      render();
    }));
  }

  /* ----- piano roll (piano part and sung melody) ----- */

  const ROLL_PPS = 90;   // pixels per second
  const ROLL_TOP = 22;   // strip for bar numbers and chords
  const ROLL_GUTTER = 34;

  function renderRoll(part) {
    const notes = (r.parts[part] && r.parts[part].notes) || [];
    if (!notes.length) { view.innerHTML = `<p class="empty">No notes were found for this part.</p>`; return; }
    const pitches = notes.map(n => n[2] + st.semis);
    let lo = Math.min(...pitches) - 2, hi = Math.max(...pitches) + 2;
    if (hi - lo < 24) { const mid = (hi + lo) >> 1; lo = mid - 12; hi = mid + 12; }
    const rowH = Math.max(6, Math.min(14, Math.floor(420 / (hi - lo + 1))));
    const lyricsStrip = part === "melody" ? 34 : 0;
    const what = part === "piano"
      ? "Notes from the piano/keys stem"
      : "The sung melody, one note at a time, ready to play on any instrument";
    view.innerHTML = `<p class="hint">${what} · ${notes.length} notes · ${st.semis ? "transposed" : "concert pitch"} · click to jump · <a href="/api/jobs/${id}/midi/${part}" download>MIDI</a></p>
      <div class="roll"><canvas></canvas></div>`;
    const canvas = view.querySelector("canvas");
    const height = ROLL_TOP + (hi - lo + 1) * rowH + lyricsStrip;
    canvas.style.height = `${height}px`;
    const lyricWords = part === "melody" ? r.lyrics.lines.flatMap(l => l.words) : [];
    roll = { part, canvas, lo, hi, rowH, height, notes, lyricWords };
    canvas.onclick = e => {
      const t = rollTime(e.offsetX);
      audio.currentTime = Math.max(0, Math.min(r.duration, t));
    };
    drawRoll();
  }

  function rollWindow() {
    const W = roll.canvas.clientWidth;
    const t0 = audio.currentTime - (W - ROLL_GUTTER) * 0.25 / ROLL_PPS; // playhead a quarter of the way in
    return { W, t0, t1: t0 + (W - ROLL_GUTTER) / ROLL_PPS };
  }
  const rollTime = x => rollWindow().t0 + (x - ROLL_GUTTER) / ROLL_PPS;

  function drawRoll() {
    if (!roll || !roll.canvas.isConnected) return;
    const { canvas, lo, hi, rowH, height, notes, lyricWords } = roll;
    const { W, t0, t1 } = rollWindow();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim(), accent2 = css.getPropertyValue("--accent-2").trim();
    const x = s => ROLL_GUTTER + (s - t0) * ROLL_PPS;
    const y = p => ROLL_TOP + (hi - p) * rowH;
    const t = audio.currentTime;

    ctx.fillStyle = "#13161c";
    ctx.fillRect(0, 0, W, height);
    for (let p = lo; p <= hi; p++) {
      if ([1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) { ctx.fillStyle = "#0e1014"; ctx.fillRect(ROLL_GUTTER, y(p), W, rowH); }
      if (((p % 12) + 12) % 12 === 0) { ctx.fillStyle = "#2a2f3a"; ctx.fillRect(ROLL_GUTTER, y(p) + rowH - 1, W, 1); }
    }
    // bars and chords
    ctx.font = "11px JetBrains Mono, monospace";
    for (const m of measures) {
      if (m.end < t0 || m.start > t1) continue;
      ctx.fillStyle = "#2a2f3a"; ctx.fillRect(x(m.start), ROLL_TOP, 1, height - ROLL_TOP);
      ctx.fillStyle = "#5a6275"; ctx.fillText(String(m.i + 1), x(m.start) + 3, 10);
    }
    for (const s of r.chords) {
      if (s.chord === "N" || s.end < t0 || s.start > t1) continue;
      ctx.fillStyle = accent; ctx.fillText(concert(s.chord), Math.max(ROLL_GUTTER, x(s.start)) + 3, 20);
    }
    // notes
    for (const [s, e, pitch, amp] of notes) {
      if (e < t0 || s > t1) continue;
      const p = pitch + st.semis;
      const active = s <= t && t < e;
      ctx.globalAlpha = active ? 1 : 0.45 + 0.55 * Math.min(1, amp);
      ctx.fillStyle = active ? accent : accent2;
      ctx.fillRect(x(s), y(p) + 1, Math.max(3, (e - s) * ROLL_PPS - 1), rowH - 2);
    }
    ctx.globalAlpha = 1;
    // lyrics under the melody
    if (lyricWords.length) {
      // Two staggered rows so quick words don't overprint; a word that fits neither is skipped.
      ctx.fillStyle = "#e7e9ee"; ctx.font = "12px Inter, sans-serif";
      const rowEnd = [-Infinity, -Infinity];
      for (const w of lyricWords) {
        if (w.start < t0 - 1 || w.start > t1) continue;
        const wx = x(w.start), width = ctx.measureText(w.text).width;
        const row = wx > rowEnd[0] + 4 ? 0 : wx > rowEnd[1] + 4 ? 1 : -1;
        if (row < 0) continue;
        ctx.fillText(w.text, wx, height - 20 + row * 14);
        rowEnd[row] = wx + width;
      }
    }
    // gutter and playhead
    ctx.fillStyle = "#13161c"; ctx.fillRect(0, ROLL_TOP, ROLL_GUTTER - 1, height);
    for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === 0) {
      ctx.fillStyle = "#8b93a7"; ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillText(`C${Math.floor(p / 12) - 1}`, 4, y(p) + rowH - 1);
    }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x(t), 0, 2, height);
  }

  /* ----- live keyboard ----- */

  const KBD_LO = 48, KBD_HI = 83; // C3 to B5
  const kbdEl = app.querySelector("#kbd");
  let keyEls = {}, kb = { name: undefined, offset: null, right: null, live: "" };

  function buildKeyboard() {
    app.querySelector("#keysBtn").classList.toggle("on", st.keys);
    kbdEl.hidden = !st.keys;
    if (!st.keys) return;
    const hasPiano = r.parts.piano && r.parts.piano.notes && r.parts.piano.notes.length;
    kbdEl.innerHTML = Chords.keyboardSVG(KBD_LO, KBD_HI) + `
      <div class="kbd-legend"><i class="k-chord"></i> chord <i class="k-left"></i> bass note <i class="k-next"></i> next chord
      ${hasPiano ? `<i class="k-live"></i> piano track` : ""}<span id="kbdName"></span></div>`;
    keyEls = {};
    kbdEl.querySelectorAll("[data-p]").forEach(el => (keyEls[el.dataset.p] = el));
    kb = { name: undefined, offset: null, right: null, live: "" };
    updateKeyboard(audio.currentTime, segIndexAt(audio.currentTime));
  }
  app.querySelector("#keysBtn").onclick = () => { st.keys = !st.keys; store.set("keys", st.keys); buildKeyboard(); };

  function setKeys(cls, pitches) {
    kbdEl.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
    for (const p of pitches) keyEls[p]?.classList.add(cls);
  }

  function updateKeyboard(t, si) {
    if (!st.keys) return;
    const seg = r.chords[si];
    const name = seg && seg.chord !== "N" ? concert(seg.chord) : null;
    const tag = `${name}|${st.semis}|${st.simple}`;
    if (tag !== kb.name) {
      kb.name = tag;
      const v = name ? Chords.pianoVoicing(name, kb.right) : null;
      const next = r.chords.slice(si + 1).find(s => s.chord !== "N");
      const nv = next ? Chords.pianoVoicing(concert(next.chord), v ? v.right : kb.right) : null;
      if (v) kb.right = v.right;
      setKeys("k-left", v ? [v.left] : []);
      setKeys("k-chord", v ? v.right : []);
      const now = new Set(v ? [v.left, ...v.right] : []);
      setKeys("k-next", nv ? [nv.left, ...nv.right].filter(p => !now.has(p)) : []);
      // Say so when the guitar is reading different (shape) names for the same chords.
      const label = offset() !== st.semis ? "piano (concert pitch): " : "";
      kbdEl.querySelector("#kbdName").textContent = name ? `${label}${name}${next ? `  →  ${concert(next.chord)}` : ""}` : "";
    }
    const notes = r.parts.piano && r.parts.piano.notes;
    if (notes && notes.length) {
      // notes sounding now: scan back from the last note that has started
      let lo = 0, hi = notes.length - 1, k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (notes[mid][0] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      const live = [];
      for (let i = k; i >= 0 && i > k - 60; i--) if (notes[i][1] > t) live.push(notes[i][2] + st.semis);
      const tagLive = live.sort().join(",");
      if (tagLive !== kb.live) { kb.live = tagLive; setKeys("k-live", live); }
    }
  }

  /* ----- upgrade older songs ----- */

  function renderUpgrade() {
    const box = app.querySelector("#upgrade");
    const others = ["bass", "piano", "drums", "melody"].some(k => r.parts[k]);
    if (others || (r.version || 1) >= 2) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="suggest"><span>This song was processed before Bandscribe wrote parts for every instrument.
      Add the bass tab, piano, drums and melody from its saved stems (about half a minute).</span>
      <button class="primary" id="doUpgrade">Transcribe all instruments</button></div>`;
    box.querySelector("#doUpgrade").onclick = async e => {
      e.target.disabled = true;
      e.target.textContent = "Transcribing…";
      try {
        const res = await api.upgrade(id);
        r.parts = res.parts;
        r.version = 2;
        delete r.tab;
        cleanup();
        showSong(job);
      } catch (err) {
        e.target.textContent = `Failed: ${err.message}`;
      }
    };
  }

  function lyricsText() {
    const lines = r.lyrics.lines;
    let text = "";
    lines.forEach((ln, i) => {
      if (i > 0 && (ln.stanza || ln.start - lines[i - 1].end > 3)) text += "\n";
      if (ln.section) text += `${ln.section}\n`;
      text += ln.words.map(w => w.text).join(" ") + "\n";
    });
    return text;
  }

  function renderLyrics() {
    const text = lyricsText();
    const pasted = !!r.lyrics.reference;
    view.innerHTML = `
      <p class="hint">${pasted ? "Your lyrics, timed to the song" : `Automatic transcription (${esc(r.lyrics.language || "unknown")})`}
        <button id="editLyrics" style="margin-left:8px">${pasted ? "Edit lyrics" : "Paste full lyrics"}</button>
        ${text ? `<button id="copy">Copy</button>` : ""}</p>
      ${text ? `<div class="lyrics-plain">${esc(text)}</div>` : `<p class="empty">No vocals were transcribed. Paste the lyrics to add them.</p>`}`;
    view.querySelector("#copy")?.addEventListener("click", e => navigator.clipboard.writeText(text).then(() => (e.target.textContent = "Copied")));
    view.querySelector("#editLyrics").onclick = () => editLyrics(pasted ? r.lyrics.text : text);
  }

  function editLyrics(initial) {
    view.innerHTML = `
      <p class="hint">Paste or type the full lyrics, one sung line per line, with a blank line between verses and choruses.
        Words the transcription heard keep their timing, and the rest are placed where the vocal track has singing.</p>
      <textarea id="lyricsBox" class="lyrics-box" spellcheck="false">${esc(initial || "")}</textarea>
      <div class="controls" style="margin-top:10px">
        <button class="primary" id="align">Line up with the song</button>
        <button id="cancel">Cancel</button>
        ${r.lyrics.reference ? `<button id="revert">Go back to the automatic transcription</button>` : ""}
        <span id="lyricsStatus" class="hint" style="margin:0"></span>
      </div>`;
    const box = view.querySelector("#lyricsBox");
    box.focus();
    const submit = async text => {
      view.querySelectorAll("button").forEach(b => (b.disabled = true));
      view.querySelector("#lyricsStatus").textContent = "Lining up…";
      try {
        r.lyrics = await api.lyrics(id, text);
        st.view = "sheet";
        store.set("view", "sheet");
        render();
      } catch (e) {
        view.querySelector("#lyricsStatus").textContent = `Failed: ${e.message}`;
        view.querySelectorAll("button").forEach(b => (b.disabled = false));
      }
    };
    view.querySelector("#align").onclick = () => box.value.trim() && submit(box.value);
    view.querySelector("#cancel").onclick = () => render();
    view.querySelector("#revert")?.addEventListener("click", () => submit(""));
  }

  /* ----- export ----- */

  function exportText() {
    const out = [
      job.title,
      `Key: ${keyName()}   Tempo: ${Math.round(r.tempo)} BPM${st.semis ? `   (transposed ${st.semis > 0 ? "+" : ""}${st.semis})` : ""}`,
      `Tuning: ${r.tuning.name}${r.tuning.capo ? `   Capo ${r.tuning.capo}` : ""}`,
      "",
    ];
    for (const b of blocks()) {
      if (b.type === "instr") {
        for (let i = 0; i < b.measures.length; i += 4) {
          out.push("| " + b.measures.slice(i, i + 4).map(m => m.chords.map(show).join(" ").padEnd(6)).join(" | ") + " |");
        }
        out.push("");
      } else {
        if (b.li > 0 && (b.gapBefore > 3 || b.line.stanza)) out.push("");
        if (b.line.section) out.push(`[${b.line.section}]`);
        let chordRow = "", lyricRow = "";
        for (const c of lineChunks(b.line)) {
          const label = c.chords.map(x => show(x.name)).join(" ");
          if (label) {
            if (chordRow.length > lyricRow.length) lyricRow = lyricRow.padEnd(chordRow.length);
            chordRow = chordRow.padEnd(lyricRow.length) + label + " ";
          }
          lyricRow += c.w.text + " ";
        }
        if (chordRow.trim()) out.push(chordRow.trimEnd());
        out.push(lyricRow.trimEnd());
      }
    }
    for (const [part, label] of PART_VIEWS.filter(([k]) => TAB_VIEWS.includes(k))) {
      const tab = r.parts[part];
      if (!tab || !tab.note_count) continue;
      const tuning = tab.tuning ? ` (${tab.tuning}${tab.capo ? `, capo ${tab.capo}` : ""})` : "";
      out.push("", "", `${label.toUpperCase()}${tuning}`, "");
      const pad = " ".repeat(tab.string_names[0].length + 1);
      for (const row of tabRows(tab, 100)) {
        out.push(pad + row.map(m => m.chords).join(""));
        tab.string_names.forEach((n, s) => out.push(n + "|" + row.map(m => m.strings[s]).join("")));
        out.push("");
      }
    }
    const blob = new Blob([out.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${job.title.replace(/[\\/:*?"<>|]+/g, "_")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ----- follow along ----- */

  let lastLine = null, lastWord = null, lastMeasures = [], lastChordName = null;
  let raf = 0;

  function tick() {
    const t = audio.currentTime;

    const si = segIndexAt(t);
    const seg = r.chords[si];
    const name = seg ? seg.chord : "N";
    if (name !== lastChordName || offset() !== tick.offset) {
      lastChordName = name;
      tick.offset = offset();
      curEl.textContent = name === "N" ? "–" : show(name);
      const next = r.chords.slice(si + 1).find(s => s.chord !== "N");
      nxtEl.textContent = next ? `→ ${show(next.chord)}` : "";
      view.querySelectorAll(".diagram").forEach(d => d.classList.toggle("on", d.dataset.chord === diagramName(name)));
    }
    updateKeyboard(t, si);
    drawRoll();

    // words
    let lo = 0, hi = words.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (words[mid].start <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const w = k >= 0 && t <= words[k].end + 0.4 ? words[k] : null;
    if (w !== lastWord) {
      lastWord?.el.classList.remove("on");
      w?.el.classList.add("on");
      lastWord = w;
    }
    const line = w ? w.lineEl : null;
    if (line && line !== lastLine) {
      lastLine?.classList.remove("on");
      line.classList.add("on");
      lastLine = line;
      followTo(line);
    }

    // measures (instrumental bars and tab)
    const cur = measureEls.filter(m => t >= m.start && t < m.end);
    if (cur.length !== lastMeasures.length || cur.some((m, i) => m !== lastMeasures[i])) {
      lastMeasures.forEach(m => m.els.forEach(e => e.classList.remove("on")));
      cur.forEach(m => m.els.forEach(e => e.classList.add("on")));
      lastMeasures = cur;
      if (TAB_VIEWS.includes(st.view) && cur[0]) followTo(cur[0].els[0].closest("pre"));
      if (st.view === "sheet" && cur[0] && !w) followTo(cur[0].els[0]);
    }

    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  // Auto-scroll: keep the current line ~30% down the space below the sticky player,
  // so the upcoming lines stay visible. Manual scrolling pauses it for a few seconds.
  let manualUntil = 0;
  const onManualScroll = () => { manualUntil = performance.now() + 4000; };
  window.addEventListener("wheel", onManualScroll, { passive: true });
  window.addEventListener("touchmove", onManualScroll, { passive: true });

  function followTo(el) {
    if (!el || !st.follow || audio.paused || performance.now() < manualUntil) return;
    const top = app.querySelector(".player").getBoundingClientRect().bottom;
    const target = window.scrollY + el.getBoundingClientRect().top - top - (window.innerHeight - top) * 0.3;
    if (Math.abs(target - window.scrollY) > 8) window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  audio.addEventListener("play", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      tick();
      const m = lastMeasures[0]?.els[0];
      followTo(TAB_VIEWS.includes(st.view) ? m?.closest("pre") : lastLine || m);
    });
  });
  audio.addEventListener("seeked", tick);

  const onKey = e => {
    if (e.code !== "Space" || e.target.closest("input, select, [contenteditable=true], button")) return;
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => { if (TAB_VIEWS.includes(st.view) || ROLL_VIEWS.includes(st.view)) render(); };
  window.addEventListener("resize", onResize);
  cleanupFns.push(() => {
    cancelAnimationFrame(raf);
    audio.pause();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", onManualScroll);
    window.removeEventListener("touchmove", onManualScroll);
    window.removeEventListener("resize", onResize);
  });

  syncTuningControls();
  updateHeader();
  renderSuggestion();
  renderUpgrade();
  buildKeyboard();
  render();
  tick();
}
