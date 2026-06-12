# One-time Testnet deploy. Requires: stellar CLI, `stellar keys add distributor --network testnet`
param(
    [string]$Source = "distributor",
    [string]$Network = "testnet"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "apps/web/.env.local"

if (-not (Get-Command stellar -ErrorAction SilentlyContinue)) {
    Write-Host "Stellar CLI not found. Install: cargo install --locked stellar-cli"
    Write-Host "Docs: https://developers.stellar.org/docs/tools/cli"
    exit 1
}

$WithdrawVk = Join-Path $Root "circuits/withdraw/target/vk"
$BatchVk = Join-Path $Root "circuits/batch_sum/target/vk"
$VerifierWasm = Join-Path $Root "target/wasm32v1-none/release/vellum_verifier.wasm"
$PoolWasm = Join-Path $Root "target/wasm32v1-none/release/vellum_pool.wasm"

if (-not (Test-Path $WithdrawVk)) {
    Write-Host "Run: pnpm circuit:build"
    exit 1
}
if (-not (Test-Path $VerifierWasm)) {
    Push-Location $Root
    cargo build -p vellum_verifier -p vellum_pool --target wasm32v1-none --release
    Pop-Location
}

$DistributorG = "GDNKKY4KRFAUAMCG4AFIUZT3I2PFWB34GG2DWF6O2BZYE2L2ZWCMXLPR"
$EmployeeG = "GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX"

Write-Host "Deploying SAC token..."
$TokenId = stellar contract asset deploy --network $Network --source $Source --alias vellum-token 2>&1 | Select-String -Pattern "C[A-Z0-9]{55}" | ForEach-Object { $_.Matches[0].Value }
if (-not $TokenId) {
    $TokenId = stellar contract id asset --network $Network --alias vellum-token 2>&1
}
Write-Host "Token: $TokenId"

Write-Host "Minting test tokens to distributor..."
stellar contract asset mint --network $Network --source $Source --asset vellum-token --to $DistributorG --amount 1000000 | Out-Null

Write-Host "Deploying withdraw verifier..."
stellar contract deploy --wasm $VerifierWasm --network $Network --source $Source --alias vellum-withdraw-verifier -- --vk_bytes-file-path $WithdrawVk | Out-Null
$WithdrawVerifier = stellar contract id --network $Network --alias vellum-withdraw-verifier

Write-Host "Deploying batch verifier..."
stellar contract deploy --wasm $VerifierWasm --network $Network --source $Source --alias vellum-batch-verifier -- --vk_bytes-file-path $BatchVk | Out-Null
$BatchVerifier = stellar contract id --network $Network --alias vellum-batch-verifier

Write-Host "Deploying pool..."
stellar contract deploy --wasm $PoolWasm --network $Network --source $Source --alias vellum-pool -- `
    --admin $DistributorG --token $TokenId --withdraw_verifier $WithdrawVerifier --batch_verifier $BatchVerifier | Out-Null
$PoolId = stellar contract id --network $Network --alias vellum-pool

Write-Host "Funding demo employee account (XLM for trustline + withdraw fees)..."
stellar tx payment --network $Network --source $Source --destination $EmployeeG --amount 50 | Out-Null

@"
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_POOL_CONTRACT_ID=$PoolId
VITE_TOKEN_CONTRACT_ID=$TokenId
"@ | Set-Content -Path $EnvFile -Encoding utf8

Write-Host ""
Write-Host "Deployed to $Network"
Write-Host "Pool:  $PoolId"
Write-Host "Token: $TokenId"
Write-Host "Wrote $EnvFile"
Write-Host "Next: pnpm dev — paste secrets in the UI (no terminal during demo)."
