#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT/circuits/scripts/build_all.sh"

echo "Artifacts:"
ls -la "$ROOT/circuits/withdraw/target/" 2>/dev/null || true
ls -la "$ROOT/circuits/batch_sum/target/" 2>/dev/null || true
