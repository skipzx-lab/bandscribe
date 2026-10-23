"""Source separation with Demucs (htdemucs_6s: drums, bass, other, vocals, guitar, piano)."""
import logging
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from .device import torch_device

log = logging.getLogger(__name__)
MODEL_NAME = "htdemucs_6s"
_model = None


def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model

        _model = get_model(MODEL_NAME)
        _model.eval()
    return _model


def separate(wav_path: Path, out_dir: Path) -> tuple[dict[str, Path], str]:
    """Split a 44.1 kHz stereo wav into stems. Returns ({stem: path}, device_used)."""
    from demucs.apply import apply_model

    model = _get_model()
    y, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    if sr != model.samplerate:
        raise ValueError(f"expected {model.samplerate} Hz audio, got {sr}")
    wav = torch.from_numpy(np.ascontiguousarray(y.T))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    mix = ((wav - mean) / std)[None]

    device = torch_device()
    try:
        with torch.no_grad():
            sources = apply_model(model, mix, device=device, split=True, overlap=0.25)
    except Exception:
        if device == "cpu":
            raise
        log.exception("Demucs failed on %s, retrying on CPU", device)
        device = "cpu"
        with torch.no_grad():
            sources = apply_model(model, mix, device=device, split=True, overlap=0.25)

    sources = sources[0].cpu() * std + mean
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, src in zip(model.sources, sources):
        path = out_dir / f"{name}.wav"
        sf.write(str(path), src.numpy().T, sr, subtype="PCM_16")
        paths[name] = path
    return paths, device
