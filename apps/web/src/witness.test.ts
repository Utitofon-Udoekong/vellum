import { describe, expect, it } from "vitest";
import { parseField } from "./commitment";
import { simulateIncrementalInserts } from "./merkle";
import { splitPubkeyLimbs } from "./pubkey";
import { recipientIdFromAddress } from "./pubkey";
import { DEMO_EMPLOYEE_G, DISTRIBUTOR_G } from "./demo-config";
import { assertWithdrawWitness, buildWithdrawWitness } from "./witness";
import { commitmentFromNote } from "./commitment";

describe("buildWithdrawWitness", () => {
  it("builds a valid witness for leaf index 1 in a two-payee batch", async () => {
    const payees = [DEMO_EMPLOYEE_G, DISTRIBUTOR_G];
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
    expect(parseField(witness.amount)).toBe(101n);
  });
});
