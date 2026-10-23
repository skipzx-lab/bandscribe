import ctypes
import os
import site
import sys
from pathlib import Path


def torch_device() -> str:
    """Device for Demucs: NVIDIA/AMD (cuda) > Intel Arc (xpu) > Apple (mps) > CPU.
    PyTorch's ROCm builds present AMD GPUs as 'cuda'. Override with BANDSCRIBE_DEVICE."""
    forced = os.environ.get("BANDSCRIBE_DEVICE")
    if forced:
        return forced
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch, "xpu", None) is not None and torch.xpu.is_available():
        return "xpu"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _register_cuda_libs() -> None:
    """Make the pip-installed NVIDIA libraries (nvidia-cublas-cu12, cuDNN) findable by CTranslate2."""
    roots = [Path(p) / "nvidia" for p in site.getsitepackages()]
    for root in filter(Path.is_dir, roots):
        if sys.platform == "win32":
            for d in root.glob("*/bin"):
                os.add_dll_directory(str(d))
                os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")
        else:
            for lib in ("cublas/lib/libcublasLt.so.12", "cublas/lib/libcublas.so.12", "cudnn/lib/libcudnn.so.9"):
                if (root / lib).exists():
                    ctypes.CDLL(str(root / lib), mode=ctypes.RTLD_GLOBAL)


def whisper_device() -> tuple[str, str]:
    """(device, compute_type) for faster-whisper. CTranslate2 only accelerates on NVIDIA;
    everything else runs int8 on the CPU. Override with BANDSCRIBE_WHISPER_DEVICE=cpu|cuda."""
    forced = os.environ.get("BANDSCRIBE_WHISPER_DEVICE")
    if forced:
        if forced == "cuda":
            _register_cuda_libs()
        return forced, "float16" if forced == "cuda" else "int8"
    try:
        import torch

        if torch.cuda.is_available() and torch.version.hip is None:  # NVIDIA, not AMD ROCm
            _register_cuda_libs()
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"
