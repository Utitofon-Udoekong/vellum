# Run ONCE before your demo (not during the recording).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

Write-Host "=== Vellum demo prep (one-time) ==="

if (-not (Test-Path "circuits/withdraw/target/vk")) {
    Write-Host "Building circuits (WSL)..."
    pnpm circuit:build
}

Write-Host "Building contracts..."
cargo build -p vellum_verifier -p vellum_pool --target wasm32v1-none --release

Write-Host "Copying circuit JSON for browser proofs..."
powershell -ExecutionPolicy Bypass -File scripts/copy-circuit-artifacts.ps1

if (Get-Command stellar -ErrorAction SilentlyContinue) {
    Write-Host "Stellar CLI found — deploying to testnet..."
    powershell -ExecutionPolicy Bypass -File scripts/deploy-testnet.ps1
} else {
    Write-Host ""
    Write-Host "Stellar CLI not installed — skip deploy for now."
    Write-Host "  cargo install --locked stellar-cli"
    Write-Host "  stellar keys add distributor --network testnet"
    Write-Host "  powershell -File scripts/deploy-testnet.ps1"
    Write-Host ""
    Write-Host "Or paste contract IDs manually into apps/web/.env.local"
}

Pop-Location
Write-Host "Done. Start UI with: pnpm dev"
