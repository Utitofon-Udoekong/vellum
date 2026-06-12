import { BarretenbergSync, Fr } from "@aztec/bb.js";

let bb: BarretenbergSync | null = null;

export async function initPoseidon(): Promise<BarretenbergSync> {
  if (!bb) {
    bb = await BarretenbergSync.initSingleton();
  }
  return bb;
}

export function fieldToFr(field: bigint): Fr {
  return new Fr(field);
}

export function frToField(fr: Fr): bigint {
  return BigInt(fr.toString());
}

/** BN254 field element as 32-byte big-endian (matches Soroban U256::from_be_bytes). */
export function frToBytes(fr: Fr): Uint8Array {
  const hex = fr.toString().replace(/^0x/i, "").padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToFr(bytes: Uint8Array): Fr {
  let v = 0n;
  for (const b of bytes) {
    v = (v << 8n) | BigInt(b);
  }
  return new Fr(v);
}

export function poseidon2Hash(api: BarretenbergSync, fields: bigint[]): Fr {
  return api.poseidon2Hash(fields.map((f) => new Fr(f)));
}

export function poseidon2HashBytes(api: BarretenbergSync, fields: bigint[]): Uint8Array {
  return frToBytes(poseidon2Hash(api, fields));
}
