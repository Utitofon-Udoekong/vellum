#!/usr/bin/env bash
set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="v0.87.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

build_circuit() {
  local name="$1"
  local dir="${ROOT}/${name}"
  [[ -f "${dir}/Nargo.toml" ]] || { echo "skip ${name}"; return; }

  echo "=== Building ${name} ==="
  pushd "${dir}" >/dev/null

  nargo compile
  nargo execute

  local project_name
  project_name=$(grep -E '^name\s*=\s*"' Nargo.toml | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')
  local json="target/${project_name}.json"
  local gz="target/${project_name}.gz"

  bb prove \
    --scheme ultra_honk \
    --oracle_hash keccak \
    --bytecode_path "${json}" \
    --witness_path "${gz}" \
    --output_path target \
    --output_format bytes_and_fields

  bb write_vk \
    --scheme ultra_honk \
    --oracle_hash keccak \
    --bytecode_path "${json}" \
    --output_path target \
    --output_format bytes_and_fields

  if [[ -d target/vk && -f target/vk/vk ]]; then
    mv target/vk/vk target/vk.tmp && rmdir target/vk && mv target/vk.tmp target/vk
  fi

  popd >/dev/null
}

for name in withdraw batch_sum; do
  build_circuit "$name"
done

echo "Circuit artifacts ready."
