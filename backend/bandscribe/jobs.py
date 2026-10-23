"""File-backed job store with a single worker thread (one song at a time keeps the GPU happy)."""
import json
import logging
import queue
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

from . import pipeline

log = logging.getLogger(__name__)


class JobStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()

    def start(self) -> None:
        for meta in sorted(self.list(), key=lambda m: m["created"]):
            if meta["status"] in ("queued", "running"):
                self._update(meta["id"], status="queued", stage="queued", progress=0.0)
                self._queue.put(meta["id"])
        threading.Thread(target=self._worker, daemon=True, name="bandscribe-worker").start()

    def dir(self, job_id: str) -> Path:
        path = (self.root / job_id).resolve()
        if path.parent != self.root.resolve():
            raise KeyError(job_id)
        return path

    def create(self, filename: str, title: str, options: dict) -> dict:
        job_id = uuid.uuid4().hex[:12]
        (self.root / job_id).mkdir()
        meta = {
            "id": job_id,
            "title": title,
            "filename": filename,
            "options": options,
            "status": "new",
            "stage": "queued",
            "stage_label": "Waiting in queue",
            "progress": 0.0,
            "error": None,
            "created": time.time(),
        }
        self._write(job_id, meta)
        return meta

    def enqueue(self, job_id: str) -> None:
        self._update(job_id, status="queued")
        self._queue.put(job_id)

    def get(self, job_id: str) -> dict:
        path = self.dir(job_id) / "meta.json"
        if not path.exists():
            raise KeyError(job_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict]:
        out = []
        for p in self.root.glob("*/meta.json"):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        return sorted(out, key=lambda m: -m["created"])

    def result(self, job_id: str) -> dict | None:
        path = self.dir(job_id) / "result.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def save_result(self, job_id: str, result: dict) -> None:
        (self.dir(job_id) / "result.json").write_text(json.dumps(result), encoding="utf-8")

    def rename(self, job_id: str, title: str) -> dict:
        return self._update(job_id, title=title)

    def delete(self, job_id: str) -> None:
        shutil.rmtree(self.dir(job_id), ignore_errors=True)

    def _write(self, job_id: str, meta: dict) -> None:
        path = self.dir(job_id) / "meta.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta), encoding="utf-8")
        tmp.replace(path)

    def _update(self, job_id: str, **fields) -> dict:
        with self._lock:
            meta = self.get(job_id)
            meta.update(fields)
            self._write(job_id, meta)
            return meta

    def _worker(self) -> None:
        while True:
            job_id = self._queue.get()
            try:
                meta = self.get(job_id)
            except KeyError:
                continue  # deleted while queued
            job_dir = self.dir(job_id)
            source = next(job_dir.glob("source.*"), None)
            try:
                if source is None:
                    raise FileNotFoundError("uploaded audio is missing")
                self._update(job_id, status="running", error=None)

                def progress(stage, label, frac):
                    self._update(job_id, stage=stage, stage_label=label, progress=round(frac, 3))

                result = pipeline.run(job_dir, source, meta.get("options", {}), progress)
                self._update(job_id, status="done", device=result["device"])
            except Exception as exc:
                log.exception("job %s failed", job_id)
                if job_dir.exists():
                    (job_dir / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
                    self._update(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
