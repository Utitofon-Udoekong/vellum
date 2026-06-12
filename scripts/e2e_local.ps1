# Local E2E smoke test orchestrator
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "=== Vellum local E2E ==="
Push-Location $Root

Write-Host "[1/4] Circuit artifacts"
if (-not (Test-Path "circuits/batch_sum/target/vk")) {
    powershell -ExecutionPolicy Bypass -File circuits/scripts/build_all.ps1
}

Write-Host "[2/4] Contract unit tests"
cargo test -p vellum_pool --release

Write-Host "[3/4] Full integration tests (with artifacts)"
cargo test -p vellum_pool --release --features circuit-artifacts

Write-Host "[4/4] WASM build"
stellar contract build --package vellum_pool

Pop-Location
Write-Host "E2E complete."
