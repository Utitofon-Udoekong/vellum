# Deploy Vellum contracts to local Stellar network.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "Building contracts..."
Push-Location $Root
stellar contract build --package vellum_pool
Pop-Location

$WithdrawVk = Join-Path $Root "circuits/withdraw/target/vk"
$BatchVk = Join-Path $Root "circuits/batch_sum/target/vk"

if (-not (Test-Path $WithdrawVk)) {
    Write-Host "Missing withdraw VK - run: pnpm circuit:build"
    exit 1
}

$VerifierWasm = Join-Path $Root "target/wasm32v1-none/release/vellum_verifier.wasm"
$PoolWasm = Join-Path $Root "target/wasm32v1-none/release/vellum_pool.wasm"
$BatchVk = Join-Path $Root "circuits/batch_sum/target/vk"

if (-not (Test-Path $VerifierWasm)) {
    cargo build -p vellum_verifier -p vellum_pool --target wasm32v1-none --release
}

Write-Host "Deploying withdraw verifier..."
stellar contract deploy --wasm $VerifierWasm --source alice --network local `
    --alias vellum-withdraw-verifier -- --vk_bytes-file-path $WithdrawVk

Write-Host "Deploying batch sum verifier..."
stellar contract deploy --wasm $VerifierWasm --source alice --network local `
    --alias vellum-batch-verifier -- --vk_bytes-file-path $BatchVk

Write-Host "Deploying Vellum pool (pass verifier IDs as constructor args)..."
stellar contract deploy --wasm $PoolWasm --source alice --network local --alias vellum-pool

Write-Host "Save contract IDs to .env.local for the web UI."
