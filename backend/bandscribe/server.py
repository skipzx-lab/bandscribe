import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import lyrics, midi, pipeline
from .audio import read_tags
from .jobs import JobStore
from .lyrics import WHISPER_MODELS

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
DATA = Path(os.environ.get("BANDSCRIBE_DATA", ROOT / "data"))
store = JobStore(DATA / "jobs")
tuning_lock = threading.Lock()  # one tab rebuild at a time (rapid tuning/capo changes)
ALLOWED_EXT = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".mp4", ".wma", ".aiff", ".aif"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.start()
    yield


app = FastAPI(title="Bandscribe", lifespan=lifespan)


@app.middleware("http")
async def revalidate_frontend(request, call_next):
    # Make the browser re-check app files on each load so updates show up without a hard refresh.
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def _get(job_id: str) -> dict:
    try:
        return store.get(job_id)
    except KeyError:
        raise HTTPException(404, "job not found")


@app.get("/api/jobs")
def list_jobs():
    return store.list()


@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    whisper_model: str = Form("small"),
    language: str = Form(""),
):
    name = file.filename or "recording.webm"
    ext = Path(name).suffix.lower() or ".webm"
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"unsupported file type {ext}")
    if whisper_model not in WHISPER_MODELS:
        raise HTTPException(400, f"unknown whisper model {whisper_model}")

    meta = store.create(name, Path(name).stem, {"whisper_model": whisper_model, "language": language.strip()})
    dest = store.dir(meta["id"]) / f"source{ext}"
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)

    tags = read_tags(dest)
    if tags.get("title"):
        title = f"{tags['artist']} - {tags['title']}" if tags.get("artist") else tags["title"]
        store.rename(meta["id"], title)
    store.enqueue(meta["id"])
    return _get(meta["id"])


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    meta = _get(job_id)
    return {**meta, "result": store.result(job_id) if meta["status"] == "done" else None}


@app.patch("/api/jobs/{job_id}")
def update_job(job_id: str, payload: dict = Body(...)):
    _get(job_id)
    title = str(payload.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "title required")
    return store.rename(job_id, title[:200])


@app.put("/api/jobs/{job_id}/result")
def save_result(job_id: str, result: dict = Body(...)):
    if _get(job_id)["status"] != "done":
        raise HTTPException(409, "job is not finished")
    store.save_result(job_id, result)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/tuning")
def set_tuning(job_id: str, payload: dict = Body(...)):
    if _get(job_id)["status"] != "done":
        raise HTTPException(409, "job is not finished")
    strings = payload.get("strings")
    capo = payload.get("capo", 0)
    if (not isinstance(strings, list) or len(strings) != 6
            or not all(isinstance(p, int) and 28 <= p <= 70 for p in strings)):
        raise HTTPException(400, "strings must be 6 MIDI pitches, low to high")
    if not isinstance(capo, int) or not 0 <= capo <= 12:
        raise HTTPException(400, "capo must be 0-12")
    name = str(payload.get("name") or "Custom")[:40]
    with tuning_lock:
        result = pipeline.retune(store.dir(job_id), store.result(job_id), name, strings, capo)
    return {"parts": result["parts"], "tuning": result["tuning"]}


@app.get("/api/jobs/{job_id}/lows")
def guitar_lows(job_id: str):
    """Seconds the guitar part spends on each low note, so the page can spot a dropped low string."""
    if _get(job_id)["status"] != "done":
        raise HTTPException(409, "job is not finished")
    lows: dict[int, float] = {}
    total = 0.0
    for n in pipeline.load_notes(store.dir(job_id), "guitar"):
        length = n["end"] - n["start"]
        total += length
        if n["pitch"] < 46:
            lows[n["pitch"]] = round(lows.get(n["pitch"], 0.0) + length, 2)
    return {"total": round(total, 2), "lows": lows}


@app.post("/api/jobs/{job_id}/parts")
def upgrade_parts(job_id: str):
    """Transcribe bass, piano, drums and melody for a song processed before they existed."""
    if _get(job_id)["status"] != "done":
        raise HTTPException(409, "job is not finished")
    with tuning_lock:
        result = pipeline.upgrade(store.dir(job_id), store.result(job_id))
    return {"parts": result["parts"]}


@app.get("/api/jobs/{job_id}/midi/{part}")
def job_midi(job_id: str, part: str):
    """MIDI for one part, or 'all' for every part as separate tracks."""
    meta = _get(job_id)
    result = store.result(job_id)
    parts = (result or {}).get("parts", {})
    wanted = list(parts) if part == "all" else [part]
    if not parts or any(p not in parts for p in wanted):
        raise HTTPException(404, "part not found")
    job_dir = store.dir(job_id)
    data = midi.build(
        result["tempo"],
        {p: pipeline.load_notes(job_dir, p) for p in wanted if p != "drums"},
        parts["drums"]["hits"] if "drums" in wanted else None,
    )
    name = "".join(c for c in meta["title"] if c.isalnum() or c in " -_").strip() or "song"
    return Response(data, media_type="audio/midi",
                    headers={"Content-Disposition": f'attachment; filename="{name} - {part}.mid"'})


@app.post("/api/jobs/{job_id}/lyrics")
def set_lyrics(job_id: str, payload: dict = Body(...)):
    """Replace the transcription with the user's own lyrics, timed against the song.
    Empty text reverts to the automatic transcription."""
    meta = _get(job_id)
    if meta["status"] != "done":
        raise HTTPException(409, "job is not finished")
    text = str(payload.get("text", ""))
    result = store.result(job_id)
    current = result["lyrics"]
    reference = current.get("reference") or [w for ln in current["lines"] for w in ln["words"]]
    if text.strip():
        lines = lyrics.align(text, reference, store.dir(job_id) / "audio" / "vocals.mp3", result["duration"],
                             meta["options"].get("whisper_model", "small"), current.get("language"))
        result["lyrics"] = {"language": current.get("language"), "lines": lines,
                            "text": text, "reference": reference}
    else:
        result["lyrics"] = {"language": current.get("language"), "lines": lyrics.lines_from_words(reference)}
    store.save_result(job_id, result)
    return result["lyrics"]


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    meta = _get(job_id)
    if meta["status"] == "running":
        raise HTTPException(409, "job is processing; wait for it to finish")
    store.delete(job_id)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: str):
    if _get(job_id)["status"] != "error":
        raise HTTPException(409, "only failed jobs can be retried")
    store.enqueue(job_id)
    return _get(job_id)


@app.get("/api/jobs/{job_id}/audio/{stem}")
def job_audio(job_id: str, stem: str):
    _get(job_id)
    if not stem.isalpha():
        raise HTTPException(400, "bad stem name")
    path = store.dir(job_id) / "audio" / f"{stem}.mp3"
    if not path.exists():
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/mpeg")


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
