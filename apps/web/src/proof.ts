import { RawBuffer, splitHonkProof } from "@aztec/bb.js";
import { decompressSync as gunzip } from "fflate";
import { Noir } from "@noir-lang/noir_js";
import { loadCrs } from "./crs";
import { loadWithdrawCircuit } from "./circuits";
import { ensureNoirWasm } from "./noir-init";
import { initPoseidon } from "./poseidon";

export interface ProofArtifacts {
  proof: Uint8Array;
  publicInputs: Uint8Array;
}

/** Decode base64 gzip ACIR bytecode from compiled Noir JSON. */
function acirToUint8Array(base64EncodedBytecode: string): Uint8Array {
  const compressed = Uint8Array.from(atob(base64EncodedBytecode), (c) => c.charCodeAt(0));
  return gunzip(compressed);
}

/** Public input count from compiled ABI (BarretenbergSync VK fields are not decimal counts). */
function countPublicInputs(circuitJson: object): number {
  const params =
    (circuitJson as { abi?: { parameters?: Array<{ visibility?: string }> } }).abi?.parameters ??
    [];
  return params.filter((p) => p.visibility === "public").length;
}

async function initProvingBackend(bytecode: Uint8Array) {
  const bb = await initPoseidon();
  const [, subgroupSize] = bb.acirGetCircuitSizes(bytecode, false, true);
  const numPoints = subgroupSize + 1;
  const { g1, g2 } = await loadCrs(numPoints);
  bb.srsInitSrs(new RawBuffer(g1), numPoints, new RawBuffer(g2));
  return bb;
}

/** Download withdraw-circuit CRS (~0.5 MB) before employee withdraw. */
export async function prewarmWithdrawProving(): Promise<void> {
  const circuit = await loadWithdrawCircuit();
  const bytecodeStr = (circuit as { bytecode?: string }).bytecode;
  if (!bytecodeStr) return;
  const bytecode = acirToUint8Array(bytecodeStr);
  const bb = await initPoseidon();
  const [, subgroupSize] = bb.acirGetCircuitSizes(bytecode, false, true);
  await loadCrs(subgroupSize + 1);
}

/**
 * Generate an UltraHonk proof for a compiled Noir circuit JSON + witness map.
 * Uses BarretenbergSync (same WASM path as Prepare) — avoids worker WASM 404 in Vite.
 */
export async function generateProof(
  circuitJson: object,
  witness: Record<string, string | string[]>,
): Promise<ProofArtifacts> {
  const bytecodeStr = (circuitJson as { bytecode?: string }).bytecode;
  if (!bytecodeStr) {
    throw new Error("Circuit JSON missing bytecode — run: pnpm demo:copy-circuits");
  }

  await ensureNoirWasm();
  const noir = new Noir(circuitJson as never);
  const { witness: witnessVec } = await noir.execute(witness);
  const bytecode = acirToUint8Array(bytecodeStr);
  const bb = await initProvingBackend(bytecode);

  const proofWithPublicInputs = bb.acirProveUltraKeccakHonk(bytecode, gunzip(witnessVec));
  const numPublicInputs = countPublicInputs(circuitJson);
  const { proof, publicInputs } = splitHonkProof(proofWithPublicInputs, numPublicInputs);

  return { proof, publicInputs };
}

export function proofToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
