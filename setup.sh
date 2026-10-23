#!/usr/bin/env bash
# Creates .venv and installs everything, with the PyTorch build for your GPU.
#   ./setup.sh            # auto-detect NVIDIA / AMD / Intel Arc / Apple / CPU
#   ./setup.sh rocm       # force one: cuda | rocm | xpu | mps | cpu
set -euo pipefail
cd "$(dirname "$0")"
GPU="${1:-auto}"
VENV="${VENV:-.venv}"

if [ "$GPU" = auto ]; then
  if command -v nvidia-smi >/dev/null 2>&1; then GPU=cuda
  elif [ -e /dev/kfd ]; then GPU=rocm
  elif [ "$(uname)" = Darwin ]; then GPU=mps
  elif command -v lspci >/dev/null 2>&1 && lspci | grep -qiE "VGA.*Intel.*Arc|Display.*Intel.*Arc"; then GPU=xpu
  else GPU=cpu
  fi
fi

PY=""
for v in python3.12 python3.11; do
  if command -v "$v" >/dev/null 2>&1; then PY="$v"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.12 or 3.11 is required." >&2; exit 1; }
echo "GPU: $GPU    Python: $PY    venv: $VENV"

[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
pip() { "$VENV/bin/python" -m pip install --disable-pip-version-check "$@"; }

pip --upgrade pip
case "$GPU" in
  cuda) pip torch --index-url https://download.pytorch.org/whl/cu128
        pip nvidia-cublas-cu12 ;;
  rocm) pip torch --index-url https://download.pytorch.org/whl/rocm7.2 ;;
  xpu)  pip torch --index-url https://download.pytorch.org/whl/xpu ;;
  mps)  pip torch ;;
  cpu)  pip torch --index-url https://download.pytorch.org/whl/cpu ;;
  *)    echo "Unknown GPU type: $GPU" >&2; exit 1 ;;
esac
# Integrated and older GPUs may not be supported by the GPU build (e.g. a Radeon 780M);
# then the CPU build is installed instead, so nothing large sits there unused.
case "$GPU" in
  rocm|xpu)
    check=$([ "$GPU" = rocm ] && echo "torch.cuda.is_available()" || echo "torch.xpu.is_available()")
    if ! "$VENV/bin/python" -c "import sys, torch; sys.exit(0 if $check else 1)" 2>/dev/null; then
      echo "WARNING: this GPU isn't supported by the $GPU build of PyTorch; installing the CPU build instead." >&2
      "$VENV/bin/python" -m pip uninstall -y torch >/dev/null
      pip torch --index-url https://download.pytorch.org/whl/cpu
    fi ;;
esac
pip -r requirements.txt
pip --no-deps basic-pitch==0.4.0

PYTHONPATH=backend "$VENV/bin/python" -c "import torch; from bandscribe.device import torch_device, whisper_device; print('torch', torch.__version__, '| separation on', torch_device(), '| lyrics on', whisper_device()[0])"
command -v ffmpeg >/dev/null 2>&1 || echo "WARNING: ffmpeg not found. Install it (apt install ffmpeg / brew install ffmpeg)." >&2
echo "Done. Start with ./run.sh"
