import { commitmentFromNote, type PayrollNote } from "./commitment";
import { bytesToFr, fieldToFr, frToBytes, frToField, initPoseidon, poseidon2Hash } from "./poseidon";
import type { BarretenbergSync } from "@aztec/bb.js";

export const TREE_DEPTH = 20;

export function zeroHash(): Uint8Array {
  return new Uint8Array(32);
}

function hashPairFields(api: BarretenbergSync, left: bigint, right: bigint): bigint {
  return frToField(poseidon2Hash(api, [left, right]));
}

/** Perfect subtree over `2^level` consecutive leaves starting at `start`. */
function hashPerfectSubtree(
  api: BarretenbergSync,
  leafFields: bigint[],
  start: number,
  level: number,
): bigint {
  if (level === 0) {
    return leafFields[start]!;
  }
  const half = 1 << (level - 1);
  const left = hashPerfectSubtree(api, leafFields, start, level - 1);
  const right = hashPerfectSubtree(api, leafFields, start + half, level - 1);
  return hashPairFields(api, left, right);
}

/** Root of the sibling subtree at `level` (may be partial when `n` is not a power of two). */
function subtreeRootAtLevel(
  api: BarretenbergSync,
  zeroes: bigint[],
  leafFields: bigint[],
  n: number,
  start: number,
  level: number,
): bigint {
  const width = 1 << level;
  if (start >= n) {
    return zeroes[level];
  }
  if (start + width <= n) {
    return hashPerfectSubtree(api, leafFields, start, level);
  }
  if (level === 0) {
    return leafFields[start]!;
  }
  const half = width >> 1;
  const left = subtreeRootAtLevel(api, zeroes, leafFields, n, start, level - 1);
  const right = subtreeRootAtLevel(api, zeroes, leafFields, n, start + half, level - 1);
  return hashPairFields(api, left, right);
}

/** Merkle path for `leafIndex` against the final root after all `n` incremental inserts. */
function merklePathForFinalRoot(
  api: BarretenbergSync,
  zeroes: bigint[],
  leafFields: bigint[],
  leafIndex: number,
): { siblings: bigint[]; bits: number[] } {
  const n = leafFields.length;
  const siblings: bigint[] = [];
  const bits: number[] = [];
  for (let level = 0; level < TREE_DEPTH; level++) {
    const bit = (leafIndex >> level) & 1;
    bits.push(bit);
    const siblingStart = ((leafIndex >> level) ^ 1) << level;
    siblings.push(subtreeRootAtLevel(api, zeroes, leafFields, n, siblingStart, level));
  }
  return { siblings, bits };
}

export async function buildZeroes(): Promise<bigint[]> {
  const api = await initPoseidon();
  const zeroes: bigint[] = [0n];
  for (let i = 0; i < TREE_DEPTH; i++) {
    zeroes.push(hashPairFields(api, zeroes[i], zeroes[i]));
  }
  return zeroes;
}

export async function rootForLeafAtIndex(leaf: Uint8Array, index: number): Promise<Uint8Array> {
  const api = await initPoseidon();
  const zeroes = await buildZeroes();
  let cur = frToField(bytesToFr(leaf));
  for (let i = 0; i < TREE_DEPTH; i++) {
    const bit = (index >> i) & 1;
    cur = bit === 0 ? hashPairFields(api, cur, zeroes[i]) : hashPairFields(api, zeroes[i], cur);
  }
  return fieldToBytes(cur);
}

/** Path for a single leaf at index 0 in an empty tree (legacy helper). */
export async function merklePathForIndex(index: number): Promise<{ siblings: bigint[]; bits: number[] }> {
  const zeroes = await buildZeroes();
  const siblings: bigint[] = [];
  const bits: number[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    bits.push((index >> i) & 1);
    siblings.push(zeroes[i]);
  }
  return { siblings, bits };
}

/** Incremental frontier insert — matches on-chain `merkle::insert_commitment`. */
export async function simulateIncrementalInserts(
  leaves: Uint8Array[],
): Promise<{
  root: Uint8Array;
  paths: Array<{ siblings: bigint[]; bits: number[] }>;
}> {
  const api = await initPoseidon();
  const zeroes = await buildZeroes();
  const frontier: (bigint | undefined)[] = [];
  const paths: Array<{ siblings: bigint[]; bits: number[] }> = [];
  let root = 0n;

  const leafFields = leaves.map((leaf) => frToField(bytesToFr(leaf)));

  for (let insIdx = 0; insIdx < leaves.length; insIdx++) {
    let cur = leafFields[insIdx];
    for (let i = 0; i < TREE_DEPTH; i++) {
      const bit = (insIdx >> i) & 1;
      if (bit === 0) {
        frontier[i] = cur;
        cur = hashPairFields(api, cur, zeroes[i]);
      } else {
        const left = frontier[i] ?? zeroes[i];
        cur = hashPairFields(api, left, cur);
      }
    }
    root = cur;
  }

  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    paths.push(merklePathForFinalRoot(api, zeroes, leafFields, leafIndex));
  }

  return { root: fieldToBytes(root), paths };
}

export function bytesToField(bytes: Uint8Array): bigint {
  return frToField(bytesToFr(bytes));
}

export function fieldToBytes(field: bigint): Uint8Array {
  return frToBytes(fieldToFr(field));
}

export async function noteToCommitment(
  note: Pick<PayrollNote, "recipientId" | "amount" | "salt">,
): Promise<Uint8Array> {
  return commitmentFromNote(note);
}
