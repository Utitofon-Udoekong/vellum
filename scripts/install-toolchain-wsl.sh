#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

if ! command -v noirup >/dev/null 2>&1; then
  echo "Installing noirup..."
  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
  export PATH="$HOME/.nargo/bin:$PATH"
fi

echo "Installing Noir 1.0.0-beta.9..."
noirup -v 1.0.0-beta.9
nargo --version

if ! command -v bbup >/dev/null 2>&1; then
  echo "Installing bbup..."
  curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
fi
export PATH="$HOME/.bb/bin:$PATH"

echo "Installing Barretenberg 0.87.0..."
bbup -v 0.87.0
bb --version

echo ""
echo "References:"
echo "  Noir on Stellar: https://jamesbachini.com/noir-on-stellar/"
echo "  UltraHonk verifier: https://github.com/NethermindEth/rs-soroban-ultrahonk"
echo "  ZK on Stellar docs: https://developers.stellar.org/docs/build/apps/zk"
echo "Toolchain ready."
