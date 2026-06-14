# One-time Testnet deploy. Requires: stellar CLI v3+, `stellar keys add distributor`
param(
    [string]$Source = "distributor",
    [string]$Network = "testnet",
    [string]$AssetCode = "VELLUM"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "apps/web/.env.local"

# Ensure cargo-installed CLIs are visible (common when pnpm spawns a fresh shell).
$pathExtras = @(
    (Join-Path $env:USERPROFILE ".cargo\bin"),
    (Join-Path $env:USERPROFILE ".local\bin")
)
foreach ($dir in $pathExtras) {
    if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
        $env:Path = "$dir;$env:Path"
    }
}

if (-not (Get-Command stellar -ErrorAction SilentlyContinue)) {
    Write-Host "Stellar CLI not found. Install: cargo install --locked stellar-cli"
    Write-Host "Docs: https://developers.stellar.org/docs/tools/cli"
    exit 1
}

function Invoke-StellarRaw {
    # Stellar CLI logs progress to stderr; do not treat that as a PowerShell error.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & stellar @args 2>&1 | ForEach-Object { "$_" }
        return @{
            ExitCode = $LASTEXITCODE
            Text     = ($lines -join "`n").Trim()
        }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Invoke-Stellar {
    $result = Invoke-StellarRaw @args
    if ($result.ExitCode -ne 0) {
        throw "stellar command failed: stellar $($args -join ' ')`n$($result.Text)"
    }
    return $result.Text
}

function Ensure-IssuerKey {
    $check = Invoke-StellarRaw keys address vellum-issuer
    if ($check.ExitCode -ne 0) {
        Write-Host "Creating vellum-issuer key..."
        Invoke-Stellar keys generate vellum-issuer | Out-Null
        Invoke-Stellar keys fund vellum-issuer --network $Network | Out-Null
    }
    return (Invoke-Stellar keys address vellum-issuer).Trim()
}

function Ensure-SacDeployed {
    param(
        [string]$AssetSpecifier,
        [string]$Alias,
        [string]$DeploySource
    )
    $idText = Invoke-Stellar contract id asset --network $Network --asset $AssetSpecifier
    $contractId = Get-ContractIdFromOutput $idText

    Write-Host "Deploying SAC token if needed ($AssetSpecifier)..."
    $deploy = Invoke-StellarRaw contract asset deploy `
        --network $Network `
        --source $DeploySource `
        --asset $AssetSpecifier `
        --alias $Alias

    if ($deploy.ExitCode -eq 0) {
        Write-Host "SAC deployed."
        return Get-ContractIdFromOutput $deploy.Text
    }
    if ($deploy.Text -match "already exists|ExistingValue") {
        Write-Host "SAC already deployed: $contractId"
        Invoke-Stellar contract alias add --id $contractId --overwrite $Alias --network $Network | Out-Null
        return $contractId
    }
    throw "SAC deploy failed:`n$($deploy.Text)"
}

function Ensure-SacAdmin {
    param(
        [string]$TokenId,
        [string]$IssuerSource,
        [string]$AdminG
    )
    Write-Host "Setting token admin to company wallet ($AdminG)..."
    $result = Invoke-StellarRaw contract invoke `
        --id $TokenId `
        --network $Network `
        --source $IssuerSource `
        '--' set_admin --new_admin $AdminG
    if ($result.ExitCode -eq 0) {
        Write-Host "Token admin updated."
        return
    }
    if ($result.Text -match "already|InvalidAction|not authorized|Missing signing key") {
        Write-Host "Token admin already configured."
        return
    }
    throw "set_admin failed:`n$($result.Text)"
}

function Get-ContractIdFromOutput {
    param([string]$Text)
    $matches = [regex]::Matches($Text, "C[A-Z0-9]{55}")
    if ($matches.Count -eq 0) {
        throw "No contract ID found in stellar output:`n$Text"
    }
    return $matches[$matches.Count - 1].Value
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

# Issuer must differ from the company wallet: issuers cannot hold their own asset.
$IssuerG = Ensure-IssuerKey
$AssetSpecifier = "${AssetCode}:${IssuerG}"
Write-Host "Asset issuer: $IssuerG"

$TokenId = Ensure-SacDeployed -AssetSpecifier $AssetSpecifier -Alias "vellum-token" -DeploySource "vellum-issuer"
Write-Host "Token: $TokenId"

Ensure-SacAdmin -TokenId $TokenId -IssuerSource "vellum-issuer" -AdminG $DistributorG

Write-Host "Creating company trustline for $AssetCode..."
$trust = Invoke-StellarRaw tx new change-trust `
    --network $Network `
    --source $Source `
    --line $AssetSpecifier
if ($trust.ExitCode -ne 0 -and $trust.Text -notmatch "already exists|ExistingValue|trustline") {
    throw "change-trust failed:`n$($trust.Text)"
}

Write-Host "Minting test tokens to company wallet..."
Invoke-Stellar contract invoke `
    --id vellum-token `
    --network $Network `
    --source $Source `
    '--' mint --to $DistributorG --amount 1000000

Write-Host "Deploying withdraw verifier..."
$withdrawDeployOut = Invoke-Stellar contract deploy `
    --wasm $VerifierWasm `
    --network $Network `
    --source $Source `
    --alias vellum-withdraw-verifier `
    '--' --vk_bytes-file-path $WithdrawVk
$WithdrawVerifier = Get-ContractIdFromOutput $withdrawDeployOut

Write-Host "Deploying batch verifier..."
$batchDeployOut = Invoke-Stellar contract deploy `
    --wasm $VerifierWasm `
    --network $Network `
    --source $Source `
    --alias vellum-batch-verifier `
    '--' --vk_bytes-file-path $BatchVk
$BatchVerifier = Get-ContractIdFromOutput $batchDeployOut

Write-Host "Deploying pool..."
$poolDeployOut = Invoke-Stellar contract deploy `
    --wasm $PoolWasm `
    --network $Network `
    --source $Source `
    --alias vellum-pool `
    '--' --admin $DistributorG --token $TokenId --withdraw_verifier $WithdrawVerifier --batch_verifier $BatchVerifier
$PoolId = Get-ContractIdFromOutput $poolDeployOut

Write-Host "Funding demo employee account (XLM for trustline + withdraw fees)..."
# Amounts in stroops (1 XLM = 10_000_000 stroops).
$employeeFunding = Invoke-StellarRaw tx new payment `
    --network $Network `
    --source $Source `
    --destination $EmployeeG `
    --amount 500000000
if ($employeeFunding.ExitCode -ne 0 -and $employeeFunding.Text -match "NoDestination") {
    Write-Host "Employee account not on network yet - creating with 50 XLM..."
    Invoke-Stellar tx new create-account `
        --network $Network `
        --source $Source `
        --destination $EmployeeG `
        --starting-balance 500000000
} elseif ($employeeFunding.ExitCode -ne 0) {
    throw "Employee funding failed:`n$($employeeFunding.Text)"
}

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
Write-Host "Next: pnpm dev (connect Freighter in the UI; no terminal during demo)."
