import { commitmentFromNote, type PayrollNote } from "./commitment";
import { simulateIncrementalInserts } from "./merkle";
import { bytesToHex, hexToBytes } from "./bytes";
import { initPoseidon, poseidon2Hash } from "./poseidon";

export interface WithdrawWitness {
  root: string;
  nullifier_hash: string;
  amount: string;
  pubkey_lo: string;
  pubkey_hi: string;
  priv_key: string;
  salt: string;
  path_siblings: string[];
  path_bits: string[];
}

export interface BatchSumWitness {
  total: string;
  amounts: string[];
}

export interface StoredNotePath {
  batchRootHex?: string;
  pathSiblings?: string[];
  pathBits?: string[];
}

export async function buildWithdrawWitness(
  note: Pick<
    PayrollNote,
    "recipientId" | "pubkeyLo" | "pubkeyHi" | "amount" | "salt" | "privKey" | "leafIndex"
  >,
  stored?: StoredNotePath,
): Promise<WithdrawWitness> {
  const api = await initPoseidon();
  const leaf = await commitmentFromNote(note);

  let path: { siblings: bigint[]; bits: number[] };
  let root: Uint8Array;

  if (stored?.pathSiblings && stored?.pathBits && stored?.batchRootHex) {
    path = {
      siblings: stored.pathSiblings.map((s) => BigInt(s)),
      bits: stored.pathBits.map((b) => Number(b)),
    };
    root = hexToBytes(stored.batchRootHex.replace(/^0x/i, ""));
  } else {
    const simulated = await simulateIncrementalInserts([leaf]);
    path = simulated.paths[0] ?? { siblings: [], bits: [] };
    root = simulated.root;
  }

  const nullifierHash = poseidon2Hash(api, [note.privKey, note.salt]);

  return {
    root: `0x${bytesToHex(root)}`,
    nullifier_hash: nullifierHash.toString(),
    amount: note.amount.toString(),
    pubkey_lo: note.pubkeyLo.toString(),
    pubkey_hi: note.pubkeyHi.toString(),
    priv_key: note.privKey.toString(),
    salt: note.salt.toString(),
    path_siblings: path.siblings.map((s) => s.toString()),
    path_bits: path.bits.map((b) => b.toString()),
  };
}

export async function buildBatchSumWitness(amounts: bigint[]): Promise<BatchSumWitness> {
  const padded = [...amounts];
  while (padded.length < 8) padded.push(0n);
  const total = padded.reduce((a, b) => a + b, 0n);
  return {
    total: total.toString(),
    amounts: padded.map((a) => a.toString()),
  };
}

export function packWithdrawPublicInputs(witness: WithdrawWitness): Uint8Array {
  const out = new Uint8Array(96);
  writeFieldBytes(out, 0, hexToBytes(witness.root.replace(/^0x/i, "")));
  writeField(out, 32, BigInt(witness.nullifier_hash));
  writeField(out, 64, BigInt(witness.amount));
  return out;
}

function writeFieldBytes(buf: Uint8Array, offset: number, bytes: Uint8Array) {
  buf.set(bytes, offset);
}

function writeField(buf: Uint8Array, offset: number, field: bigint) {
  const hex = field.toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) {
    buf[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
}
