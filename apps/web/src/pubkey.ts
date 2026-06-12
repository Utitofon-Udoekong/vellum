import { Keypair } from "@stellar/stellar-sdk";
import { initPoseidon, poseidon2Hash, frToField } from "./poseidon";

/** Split a 32-byte Ed25519 pubkey into two 128-bit big-endian limbs (BN254-safe). */
export function splitPubkeyLimbs(address: string): { lo: bigint; hi: bigint } {
  const pk = Uint8Array.from(Keypair.fromPublicKey(address).rawPublicKey());
  let lo = 0n;
  let hi = 0n;
  for (let i = 0; i < 16; i++) lo = (lo << 8n) | BigInt(pk[i]);
  for (let i = 16; i < 32; i++) hi = (hi << 8n) | BigInt(pk[i]);
  return { lo, hi };
}

/** Poseidon2(lo, hi) — matches withdraw circuit `recipient_id`. */
export async function recipientIdFromAddress(address: string): Promise<bigint> {
  const api = await initPoseidon();
  const { lo, hi } = splitPubkeyLimbs(address);
  return frToField(poseidon2Hash(api, [lo, hi]));
}

export function splitPubkeyLimbsFromBytes(pk: Uint8Array): { lo: bigint; hi: bigint } {
  let lo = 0n;
  let hi = 0n;
  for (let i = 0; i < 16; i++) lo = (lo << 8n) | BigInt(pk[i]);
  for (let i = 16; i < 32; i++) hi = (hi << 8n) | BigInt(pk[i]);
  return { lo, hi };
}
