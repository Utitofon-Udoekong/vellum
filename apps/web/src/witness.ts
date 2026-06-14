import { commitmentFromNote, parseField, type PayrollNote } from "./commitment";
import { simulateIncrementalInserts, TREE_DEPTH } from "./merkle";
import { bytesToHex, hexToBytes } from "./bytes";
import { splitPubkeyLimbs } from "./pubkey";
import { noteSecretsForLeafIndex } from "./session";
import {
  bytesToFr,
  fieldToFr,
  frToBytes,
  frToField,
  initPoseidon,
  poseidon2Hash,
} from "./poseidon";

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

export interface BatchNoteForMerkle {
  payeeAddress: string;
  amount: bigint;
  leafIndex: number;
}

function hash2Fields(api: Awaited<ReturnType<typeof initPoseidon>>, a: bigint, b: bigint): bigint {
  return frToField(poseidon2Hash(api, [a, b]));
}

function hash3Fields(
  api: Awaited<ReturnType<typeof initPoseidon>>,
  a: bigint,
  b: bigint,
  c: bigint,
): bigint {
  return frToField(poseidon2Hash(api, [a, b, c]));
}

function computeRootFromPath(
  api: Awaited<ReturnType<typeof initPoseidon>>,
  leaf: bigint,
  siblings: bigint[],
  bits: number[],
): bigint {
  let cur = leaf;
  for (let i = 0; i < TREE_DEPTH; i++) {
    const sib = siblings[i] ?? 0n;
    const bit = bits[i] ?? 0;
    if (bit !== 0 && bit !== 1) {
      throw new Error(`Invalid Merkle path bit at level ${i}`);
    }
    cur = bit === 0 ? hash2Fields(api, cur, sib) : hash2Fields(api, sib, cur);
  }
  return cur;
}


async function buildBatchLeaves(batchNotes: BatchNoteForMerkle[]): Promise<Uint8Array[]> {
  const api = await initPoseidon();
  const ordered = [...batchNotes].sort((a, b) => a.leafIndex - b.leafIndex);
  const leaves: Uint8Array[] = [];
  for (const n of ordered) {
    const { lo, hi } = splitPubkeyLimbs(n.payeeAddress);
    const recipientId = hash2Fields(api, lo, hi);
    const { salt } = noteSecretsForLeafIndex(n.leafIndex);
    leaves.push(await commitmentFromNote({ recipientId, amount: n.amount, salt }));
  }
  return leaves;
}

/** Verify witness satisfies withdraw circuit constraints before calling Noir. */
export async function assertWithdrawWitness(witness: WithdrawWitness): Promise<void> {
  const api = await initPoseidon();
  const lo = BigInt(witness.pubkey_lo);
  const hi = BigInt(witness.pubkey_hi);
  const amount = BigInt(witness.amount);
  const salt = BigInt(witness.salt);
  const privKey = BigInt(witness.priv_key);

  const nullifier = hash2Fields(api, privKey, salt);
  const expectedNullifier = parseField(witness.nullifier_hash);
  if (nullifier !== expectedNullifier) {
    throw new Error("Withdraw witness nullifier does not match private key and salt.");
  }

  const leaf = hash3Fields(api, hash2Fields(api, lo, hi), amount, salt);
  const siblings = witness.path_siblings.map((s) => BigInt(s));
  const bits = witness.path_bits.map((b) => Number(b));
  if (siblings.length !== TREE_DEPTH || bits.length !== TREE_DEPTH) {
    throw new Error(`Withdraw witness Merkle path must have depth ${TREE_DEPTH}.`);
  }

  const computedRoot = computeRootFromPath(api, leaf, siblings, bits);
  const expectedRoot = parseField(witness.root);
  if (computedRoot !== expectedRoot) {
    throw new Error(
      "Withdraw witness Merkle path does not match root — run Company → Prepare again and redeposit, or pick the correct Claim as payee.",
    );
  }
}

export async function buildWithdrawWitness(
  note: Pick<
    PayrollNote,
    "recipientId" | "pubkeyLo" | "pubkeyHi" | "amount" | "salt" | "privKey" | "leafIndex"
  > & { payeeAddress?: string },
  stored?: StoredNotePath,
  batchNotes?: BatchNoteForMerkle[],
): Promise<WithdrawWitness> {
  const api = await initPoseidon();

  let pubkeyLo = note.pubkeyLo;
  let pubkeyHi = note.pubkeyHi;
  if (note.payeeAddress) {
    ({ lo: pubkeyLo, hi: pubkeyHi } = splitPubkeyLimbs(note.payeeAddress));
  }

  let path: { siblings: bigint[]; bits: number[] };
  let root: Uint8Array;

  if (batchNotes?.length) {
    const leaves = await buildBatchLeaves(batchNotes);
    const simulated = await simulateIncrementalInserts(leaves);
    if (note.leafIndex < 0 || note.leafIndex >= simulated.paths.length) {
      throw new Error(
        `Invalid leaf index ${note.leafIndex} for batch of ${simulated.paths.length} payee(s).`,
      );
    }
    path = simulated.paths[note.leafIndex];
    root = simulated.root;

    if (stored?.batchRootHex) {
      const storedRoot = stored.batchRootHex.replace(/^0x/i, "").toLowerCase();
      const computedRoot = bytesToHex(root).toLowerCase();
      if (storedRoot !== computedRoot) {
        throw new Error(
          "Stored batch root is stale — run Company → Prepare again before withdrawing.",
        );
      }
    }
  } else if (stored?.pathSiblings && stored?.pathBits && stored?.batchRootHex) {
    path = {
      siblings: stored.pathSiblings.map((s) => BigInt(s)),
      bits: stored.pathBits.map((b) => Number(b)),
    };
    root = hexToBytes(stored.batchRootHex.replace(/^0x/i, ""));
  } else {
    const leaf = await commitmentFromNote({
      recipientId: note.recipientId,
      amount: note.amount,
      salt: note.salt,
    });
    const simulated = await simulateIncrementalInserts([leaf]);
    path = simulated.paths[0] ?? { siblings: [], bits: [] };
    root = simulated.root;
  }

  if (path.siblings.length !== TREE_DEPTH || path.bits.length !== TREE_DEPTH) {
    throw new Error(
      `Merkle path has depth ${path.siblings.length}, expected ${TREE_DEPTH}. Run Company → Prepare again.`,
    );
  }

  const nullifierFr = poseidon2Hash(api, [note.privKey, note.salt]);

  const witness: WithdrawWitness = {
    root: frToField(bytesToFr(root)).toString(),
    nullifier_hash: frToField(nullifierFr).toString(),
    amount: note.amount.toString(),
    pubkey_lo: pubkeyLo.toString(),
    pubkey_hi: pubkeyHi.toString(),
    priv_key: note.privKey.toString(),
    salt: note.salt.toString(),
    path_siblings: path.siblings.map((s) => s.toString()),
    path_bits: path.bits.map((b) => b.toString()),
  };

  await assertWithdrawWitness(witness);
  return witness;
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
  writeFieldBytes(out, 0, frToBytes(fieldToFr(parseField(witness.root))));
  writeField(out, 32, parseField(witness.nullifier_hash));
  writeField(out, 64, parseField(witness.amount));
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
