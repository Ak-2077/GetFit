# ─────────────────────────────────────────────────────────────
# start-tunnel.ps1
# Starts a Cloudflare quick tunnel pointing at localhost:5000.
#
# Usage (from anywhere):
#   powershell -File c:\Users\RENTKAR\Desktop\GetFit\Backend\scripts\start-tunnel.ps1
#
# What it does:
#   1. Checks the backend is actually listening on :5000
#   2. Starts `cloudflared tunnel --url http://localhost:5000`
#   3. Prints big-and-loud reminders about updating App Store Connect
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== GetFit Cloudflare Tunnel ===" -ForegroundColor Cyan
Write-Host ""

# Probe localhost:5000 — the tunnel works only if backend is up first.
try {
    $probe = Invoke-WebRequest -Uri "http://localhost:5000/" -UseBasicParsing -TimeoutSec 2
    Write-Host "[OK] Backend responding on :5000  (status $($probe.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "[!] Backend is NOT running on :5000" -ForegroundColor Red
    Write-Host "    Start it first in another terminal:" -ForegroundColor Yellow
    Write-Host "    cd c:\Users\RENTKAR\Desktop\GetFit\Backend; npm start" -ForegroundColor Yellow
    exit 1
}

# Make sure cloudflared is installed
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "[!] cloudflared not on PATH" -ForegroundColor Red
    Write-Host "    Install: winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Reminder: copy the trycloudflare.com URL below" -ForegroundColor Magenta
Write-Host "  -> append /api/payments/apple/webhook" -ForegroundColor Magenta
Write-Host "  -> paste into App Store Connect" -ForegroundColor Magenta
Write-Host "     App Information -> App Store Server Notifications" -ForegroundColor Magenta
Write-Host "     (both Sandbox and Production fields)" -ForegroundColor Magenta
Write-Host ""

cloudflared tunnel --url http://localhost:5000
