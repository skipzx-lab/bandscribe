# Starts the app at http://localhost:8765 (pass -Port to change it)
param([int]$Port = 8765)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONPATH = "$PSScriptRoot\backend"
Start-Process "http://localhost:$Port"
& "$PSScriptRoot\.venv\Scripts\python.exe" -m uvicorn bandscribe.server:app --host 127.0.0.1 --port $Port
