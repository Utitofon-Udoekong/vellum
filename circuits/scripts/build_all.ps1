# Build Noir circuits + Barretenberg artifacts (requires nargo 1.0.0-beta.9 and bb 0.87.0 in PATH)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

foreach ($name in @("withdraw", "batch_sum")) {
    $dir = Join-Path $Root $name
    if (-not (Test-Path (Join-Path $dir "Nargo.toml"))) { continue }

    Write-Host "=== Building $name ==="
    Push-Location $dir
    try {
        nargo compile
        nargo execute

        $nargoToml = Get-Content Nargo.toml -Raw
        if ($nargoToml -match 'name\s*=\s*"([^"]+)"') {
            $projectName = $Matches[1]
        } else {
            throw "Could not parse package name from Nargo.toml"
        }

        $json = "target/$projectName.json"
        $gz = "target/$projectName.gz"

        bb prove --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $json --witness_path $gz `
            --output_path target --output_format bytes_and_fields

        bb write_vk --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $json --output_path target --output_format bytes_and_fields

        if (Test-Path "target/vk/vk") {
            Move-Item -Force "target/vk/vk" "target/vk.bin"
            Remove-Item -Recurse -Force "target/vk"
            Move-Item -Force "target/vk.bin" "target/vk"
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Circuit artifacts ready."
