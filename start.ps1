# DOGS Sampler — dev server launcher (Windows PowerShell).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm not found — install Node.js first.'
  exit 1
}
if (-not (Test-Path node_modules)) {
  Write-Host 'node_modules missing — installing…'
  npm install
}

npm run dev -- --host --port 5173
