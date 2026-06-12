# Copy Noir circuit JSON into the web app public folder (for in-browser proving).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root "apps/web/public/circuits"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$WithdrawJson = Join-Path $Root "circuits/withdraw/target/vellum_withdraw.json"
$BatchJson = Join-Path $Root "circuits/batch_sum/target/vellum_batch_sum.json"

if (-not (Test-Path $WithdrawJson)) {
    Write-Host "Missing $WithdrawJson - run: pnpm circuit:build"
    exit 1
}

Copy-Item $WithdrawJson (Join-Path $Out "vellum_withdraw.json") -Force
Copy-Item $BatchJson (Join-Path $Out "vellum_batch_sum.json") -Force
Write-Host "Circuit JSON copied to apps/web/public/circuits/"
