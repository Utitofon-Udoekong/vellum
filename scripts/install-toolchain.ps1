# Install Noir + Barretenberg for Vellum circuit builds (Windows)
$ErrorActionPreference = "Stop"

Write-Host "Installing Noir 1.0.0-beta.9..."
if (-not (Get-Command noirup -ErrorAction SilentlyContinue)) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/noir-lang/noirup/main/install.ps1" -OutFile "$env:TEMP\noirup-install.ps1"
    & "$env:TEMP\noirup-install.ps1"
}
noirup -v 1.0.0-beta.9

Write-Host "Installing Barretenberg 0.87.0..."
if (-not (Get-Command bbup -ErrorAction SilentlyContinue)) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install" -OutFile "$env:TEMP\bbup-install.sh"
    Write-Host "Run bbup manually from WSL/Git Bash if bbup is unavailable on Windows."
} else {
    bbup -v 0.87.0
}

Write-Host "Adding Rust wasm target..."
rustup target add wasm32v1-none

Write-Host "Done. Verify: nargo --version; bb --version"
