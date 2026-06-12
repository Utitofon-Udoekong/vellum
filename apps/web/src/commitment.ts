import { initPoseidon, poseidon2HashBytes } from "./poseidon";
import { recipientIdFromAddress } from "./pubkey";

/** Payroll leaf note — kept off-chain until employee withdraws. */
export interface PayrollNote {
  recipientId: bigint;
  pubkeyLo: bigint;
  pubkeyHi: bigint;
  amount: bigint;
  salt: bigint;
  privKey: bigint;
  leafIndex: number;
}

export interface EmployeeRow {
  label: string;
  payeeAddress: string;
  amount: string;
  salt: string;
  privKey: string;
}

export async function commitmentFromNote(
  note: Pick<PayrollNote, "recipientId" | "amount" | "salt">,
): Promise<Uint8Array> {
  const api = await initPoseidon();
  return poseidon2HashBytes(api, [note.recipientId, note.amount, note.salt]);
}

export async function commitmentFromPayeeAddress(
  payeeAddress: string,
  amount: bigint,
  salt: bigint,
): Promise<Uint8Array> {
  const recipientId = await recipientIdFromAddress(payeeAddress);
  return commitmentFromNote({ recipientId, amount, salt });
}

export async function nullifierFromNote(
  note: Pick<PayrollNote, "privKey" | "salt">,
): Promise<Uint8Array> {
  const api = await initPoseidon();
  return poseidon2HashBytes(api, [note.privKey, note.salt]);
}

export function parseField(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x")) {
    return BigInt(trimmed);
  }
  return BigInt(trimmed);
}
