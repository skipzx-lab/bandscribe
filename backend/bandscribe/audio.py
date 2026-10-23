import json
import shutil
import subprocess
from pathlib import Path

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"


def _ffmpeg(*args: str) -> None:
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *args],
        check=True,
        capture_output=True,
    )


def to_wav(src: Path, dst: Path, sr: int = 44100) -> None:
    _ffmpeg("-i", str(src), "-vn", "-ac", "2", "-ar", str(sr), str(dst))


def to_mp3(src: Path, dst: Path) -> None:
    _ffmpeg("-i", str(src), "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", str(dst))


def read_tags(src: Path) -> dict:
    """Return {'title': ..., 'artist': ...} from file metadata, if present."""
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format_tags=title,artist",
             "-of", "json", str(src)],
            check=True, capture_output=True, text=True,
        ).stdout
        tags = json.loads(out).get("format", {}).get("tags", {})
        return {k.lower(): v for k, v in tags.items()}
    except Exception:
        return {}
