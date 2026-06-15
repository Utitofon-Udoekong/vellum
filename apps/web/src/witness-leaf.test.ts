import { describe, expect, it } from "vitest";
import { commitmentFromNote } from "./commitment";
import { initPoseidon, poseidon2Hash, frToField, bytesToFr } from "./poseidon";
import { splitPubkeyLimbs } from "./pubkey";
import { noteSecretsForLeafIndex } from "./session";

const PAYEES = [
  "GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX",
  "GCOZFZHWB6CEVXWHUR7P7RJJSFR2USUCEKVAP7BTUMWPC77VMXYXCIRR",
];

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

describe("withdraw leaf encoding", () => {
  it("assert path matches merkle tree leaf bytes for demo payees and amounts", async () => {
    const api = await initPoseidon();
    const amounts = [100n, 101n];

    for (let i = 0; i < PAYEES.length; i++) {
      const { lo, hi } = splitPubkeyLimbs(PAYEES[i]);
      const amount = amounts[i];
      const { salt } = noteSecretsForLeafIndex(i);
      const recipientId = hash2Fields(api, lo, hi);

      const fromCommitment = frToField(
        bytesToFr(await commitmentFromNote({ recipientId, amount, salt })),
      );
      const fromAssert = hash3Fields(api, hash2Fields(api, lo, hi), amount, salt);

      expect(fromAssert).toBe(fromCommitment);
    }
  });
});
