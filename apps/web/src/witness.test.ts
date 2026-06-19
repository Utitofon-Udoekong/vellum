import { describe, expect, it } from "vitest";
import { parseField } from "./commitment";
import { simulateIncrementalInserts } from "./merkle";
import { splitPubkeyLimbs } from "./pubkey";
import { recipientIdFromAddress } from "./pubkey";
import { assertWithdrawWitness, buildWithdrawWitness, packWithdrawPublicInputs } from "./witness";
import { commitmentFromNote } from "./commitment";
import { noteSecretsForLeafIndex } from "./session";
import { parseHumanAmount } from "./token-amount";
import type { StoredNote } from "./types";

const TEST_PAYEE_A =
  "GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX";
const TEST_PAYEE_B =
  "GCOZFZHWB6CEVXWHUR7P7RJJSFR2USUCEKVAP7BTUMWPC77VMXYXCIRR";

async function twoPayeeBatch() {
  const payees = [TEST_PAYEE_A, TEST_PAYEE_B];
  const batchNotes = await Promise.all(
    payees.map(async (payeeAddress, i) => {
      const { lo, hi } = splitPubkeyLimbs(payeeAddress);
      const recipientId = await recipientIdFromAddress(payeeAddress);
      return {
        payeeAddress,
        recipientId,
        pubkeyLo: lo,
        pubkeyHi: hi,
        amount: 100n + BigInt(i),
        salt: BigInt(42 + i),
        privKey: BigInt(7 + i),
        leafIndex: i,
      };
    }),
  );

  const leaves = await Promise.all(
    batchNotes.map((n) =>
      commitmentFromNote({ recipientId: n.recipientId, amount: n.amount, salt: n.salt }),
    ),
  );
  const { root, paths } = await simulateIncrementalInserts(leaves);
  return { batchNotes, root, paths };
}

describe("buildWithdrawWitness", () => {
  it("builds a valid witness for leaf index 0 in a two-payee batch", async () => {
    const { batchNotes, root, paths } = await twoPayeeBatch();
    const note = batchNotes[0];

    const witness = await buildWithdrawWitness(
      {
        recipientId: note.recipientId,
        pubkeyLo: note.pubkeyLo,
        pubkeyHi: note.pubkeyHi,
        amount: note.amount,
        salt: note.salt,
        privKey: note.privKey,
        leafIndex: note.leafIndex,
        payeeAddress: note.payeeAddress,
      },
      {
        batchRootHex: Array.from(root)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
        pathSiblings: paths[0].siblings.map((s) => s.toString()),
        pathBits: paths[0].bits.map((b) => b.toString()),
      },
      batchNotes.map((n) => ({
        payeeAddress: n.payeeAddress,
        amount: n.amount,
        leafIndex: n.leafIndex,
      })),
    );

    await assertWithdrawWitness(witness);
    expect(parseField(witness.recipient_id)).toBe(note.recipientId);
  });

  it("builds a valid witness for leaf index 1 in a two-payee batch", async () => {
    const { batchNotes, root, paths } = await twoPayeeBatch();
    const note = batchNotes[1];

    const witness = await buildWithdrawWitness(
      {
        recipientId: note.recipientId,
        pubkeyLo: note.pubkeyLo,
        pubkeyHi: note.pubkeyHi,
        amount: note.amount,
        salt: note.salt,
        privKey: note.privKey,
        leafIndex: note.leafIndex,
        payeeAddress: note.payeeAddress,
      },
      {
        batchRootHex: Array.from(root)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
        pathSiblings: paths[1].siblings.map((s) => s.toString()),
        pathBits: paths[1].bits.map((b) => b.toString()),
      },
      batchNotes.map((n) => ({
        payeeAddress: n.payeeAddress,
        amount: n.amount,
        leafIndex: n.leafIndex,
      })),
    );

    await assertWithdrawWitness(witness);
    expect(parseField(witness.recipient_id)).toBe(note.recipientId);
    expect(parseField(witness.amount)).toBe(101n);
  });

  it("packWithdrawPublicInputs encodes 128 bytes with recipient_id", async () => {
    const { batchNotes, root, paths } = await twoPayeeBatch();
    const note = batchNotes[0];
    const witness = await buildWithdrawWitness(
      {
        recipientId: note.recipientId,
        pubkeyLo: note.pubkeyLo,
        pubkeyHi: note.pubkeyHi,
        amount: note.amount,
        salt: note.salt,
        privKey: note.privKey,
        leafIndex: note.leafIndex,
        payeeAddress: note.payeeAddress,
      },
      {
        batchRootHex: Array.from(root)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
        pathSiblings: paths[0].siblings.map((s) => s.toString()),
        pathBits: paths[0].bits.map((b) => b.toString()),
      },
      batchNotes.map((n) => ({
        payeeAddress: n.payeeAddress,
        amount: n.amount,
        leafIndex: n.leafIndex,
      })),
    );
    const packed = packWithdrawPublicInputs(witness);
    expect(packed.length).toBe(128);
    expect(parseField(witness.recipient_id)).toBe(note.recipientId);
  });

  /** Mirrors App.tsx prepare → localStorage → employeeWithdraw for both payee rows. */
  it("builds witnesses after StoredNote JSON round-trip for each payee row", async () => {
    const payees = [TEST_PAYEE_A, TEST_PAYEE_B];
    const decimals = 7;

    const draftNotes = await Promise.all(
      payees.map(async (payeeAddress, i) => {
        const { lo, hi } = splitPubkeyLimbs(payeeAddress);
        const recipientId = await recipientIdFromAddress(payeeAddress);
        const amount = parseHumanAmount(i === 0 ? "100" : "250", decimals);
        return {
          payeeAddress,
          pubkeyLo: lo,
          pubkeyHi: hi,
          recipientId,
          amount,
          salt: BigInt(42 + i),
          privKey: BigInt(7 + i),
          leafIndex: i,
        };
      }),
    );

    const leaves = await Promise.all(
      draftNotes.map((n) =>
        commitmentFromNote({ recipientId: n.recipientId, amount: n.amount, salt: n.salt }),
      ),
    );
    const { root, paths } = await simulateIncrementalInserts(leaves);
    const batchRootHex = Array.from(root)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const storedNotes: StoredNote[] = draftNotes.map((n, i) => ({
      payeeAddress: n.payeeAddress,
      pubkeyLo: n.pubkeyLo.toString(),
      pubkeyHi: n.pubkeyHi.toString(),
      recipientId: n.recipientId.toString(),
      amount: n.amount.toString(),
      salt: n.salt.toString(),
      privKey: n.privKey.toString(),
      leafIndex: i,
      batchRootHex,
      pathSiblings: paths[i].siblings.map((s) => s.toString()),
      pathBits: paths[i].bits.map((b) => b.toString()),
    }));

    const sessionNotes = JSON.parse(JSON.stringify(storedNotes)) as StoredNote[];

    for (const selectedNoteIdx of [0, 1]) {
      const note = sessionNotes[selectedNoteIdx];
      const { salt, privKey } = noteSecretsForLeafIndex(selectedNoteIdx);
      const witness = await buildWithdrawWitness(
        {
          recipientId: parseField(note.recipientId),
          pubkeyLo: parseField(note.pubkeyLo),
          pubkeyHi: parseField(note.pubkeyHi),
          amount: parseField(note.amount),
          salt,
          privKey,
          leafIndex: selectedNoteIdx,
          payeeAddress: note.payeeAddress,
        },
        {
          batchRootHex: note.batchRootHex,
          pathSiblings: note.pathSiblings,
          pathBits: note.pathBits,
        },
        sessionNotes.map((n, i) => ({
          payeeAddress: n.payeeAddress,
          amount: parseField(n.amount),
          leafIndex: i,
        })),
      );
      await assertWithdrawWitness(witness);
      expect(parseField(witness.recipient_id)).toBe(parseField(note.recipientId));
    }
  });
});
