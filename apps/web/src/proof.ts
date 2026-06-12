import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

export interface ProofArtifacts {
  proof: Uint8Array;
  publicInputs: Uint8Array;
}

/**
 * Generate an UltraHonk proof for a compiled Noir circuit JSON + witness map.
 * Requires circuit artifacts from `pnpm circuit:build` and `pnpm demo:copy-circuits`.
 */
export async function generateProof(
  circuitJson: object,
  witness: Record<string, string | string[]>,
): Promise<ProofArtifacts> {
  const noir = new Noir(circuitJson as never);
  const { witness: witnessVec } = await noir.execute(witness);

  const backend = new UltraHonkBackend((circuitJson as { bytecode: string }).bytecode);
  const result = await backend.generateProof(witnessVec);
  await backend.destroy();

  return {
    proof: result.proof,
    publicInputs: flattenPublicInputFields(result.publicInputs),
  };
}

/** Pack Noir public input decimal fields into 32-byte big-endian slots (bb.js layout). */
function flattenPublicInputFields(fields: string[]): Uint8Array {
  const out = new Uint8Array(fields.length * 32);
  fields.forEach((field, i) => {
    const hex = BigInt(field).toString(16).padStart(64, "0");
    for (let j = 0; j < 32; j++) {
      out[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    }
  });
  return out;
}

export function proofToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
