# Creates .venv and installs everything, with the PyTorch build for your GPU.
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1              # auto-detect NVIDIA / AMD / Intel Arc / CPU
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Gpu cuda    # force one: cuda | rocm | xpu | cpu
param(
    [ValidateSet("auto", "cuda", "rocm", "xpu", "cpu")] [string]$Gpu = "auto",
    [string]$Venv = ".venv"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ROCM = "https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1"

function Find-Gpu {
    $names = (Get-CimInstance Win32_VideoController | ForEach-Object Name) -join "; "
    if ($names -match "NVIDIA") { return "cuda" }
    if ($names -match "Radeon") { return "rocm" }
    if ($names -match "Intel\(R\) Arc") { return "xpu" }
    return "cpu"
}

function Find-Python([string[]]$versions) {
    # Windows PowerShell turns a native command's stderr into an error under "Stop".
    $ErrorActionPreference = "Continue"
    foreach ($v in $versions) {
        try { & py "-$v" -c "import sys" 2>$null } catch { continue }
        if ($LASTEXITCODE -eq 0) { return $v }
    }
    return $null
}

if ($Gpu -eq "auto") { $Gpu = Find-Gpu }
# AMD's Windows PyTorch wheels are built for Python 3.12 only.
$pyVersions = if ($Gpu -eq "rocm") { @("3.12") } else { @("3.12", "3.11") }
$py = Find-Python $pyVersions
if (-not $py) {
    throw "Python $($pyVersions -join ' or ') is required (python.org or 'winget install Python.Python.3.12')."
}
Write-Host "GPU: $Gpu    Python: $py    venv: $Venv" -ForegroundColor Cyan

if (-not (Test-Path "$Venv\Scripts\python.exe")) { & py "-$py" -m venv $Venv }
$python = Resolve-Path "$Venv\Scripts\python.exe"
function Pip { & $python -m pip install --disable-pip-version-check @args; if ($LASTEXITCODE) { throw "pip install failed" } }

Pip --upgrade pip
switch ($Gpu) {
    "cuda" {
        # CUDA 12.8 builds cover RTX 20-series through RTX 50-series. Whisper (CTranslate2)
        # needs CUDA 12's cuBLAS, which nvidia-cublas-cu12 provides.
        Pip torch --index-url https://download.pytorch.org/whl/cu128
        Pip nvidia-cublas-cu12
    }
    "rocm" {
        # AMD's ROCm 7.2.1 for Windows; needs Adrenalin driver 26.2.2 or newer.
        Pip --no-cache-dir "$ROCM/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl" `
            "$ROCM/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl" `
            "$ROCM/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl" `
            "$ROCM/rocm-7.2.1.tar.gz"
        Pip --no-cache-dir "$ROCM/torch-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl"
    }
    "xpu" { Pip torch --index-url https://download.pytorch.org/whl/xpu }
    "cpu" { Pip torch --index-url https://download.pytorch.org/whl/cpu }
}
# Integrated and older GPUs may not be supported by the GPU build (e.g. a Radeon 780M on
# Windows). Then the CPU build is installed instead, so nothing large sits there unused.
if ($Gpu -in @("rocm", "xpu")) {
    $check = if ($Gpu -eq "rocm") { "torch.cuda.is_available()" } else { "torch.xpu.is_available()" }
    $ErrorActionPreference = "Continue"  # stderr from the check must not abort the script
    & $python -c "import sys, torch; sys.exit(0 if $check else 1)" 2>$null
    $supported = $LASTEXITCODE -eq 0
    $ErrorActionPreference = "Stop"
    if (-not $supported) {
        Write-Warning "This GPU isn't supported by the $Gpu build of PyTorch; installing the CPU build instead."
        & $python -m pip uninstall -y torch | Out-Null
        Pip torch --index-url https://download.pytorch.org/whl/cpu
    }
}
Pip -r requirements.txt
Pip --no-deps basic-pitch==0.4.0

$env:PYTHONPATH = "$PSScriptRoot\backend"
& $python -c "import torch; from bandscribe.device import torch_device, whisper_device; print('torch', torch.__version__, '| separation on', torch_device(), '| lyrics on', whisper_device()[0])"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "ffmpeg was not found on PATH. Install it with: winget install Gyan.FFmpeg"
}
Write-Host "Done. Start Bandscribe with:  powershell -ExecutionPolicy Bypass -File .\run.ps1" -ForegroundColor Green
