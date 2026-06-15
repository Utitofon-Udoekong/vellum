import { describe, expect, it } from "vitest";
import { buildZeroes, rootForLeafAtIndex } from "./merkle";
import { commitmentFromPayeeAddress } from "./commitment";
import { bytesToHex } from "./bytes";
import { recipientIdFromAddress } from "./pubkey";

const TEST_PAYEE_G =
  "GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX";

describe("merkle", () => {
  it("builds zero chain", async () => {
    const zeroes = await buildZeroes();
    expect(zeroes[0]).toBe(0n);
    expect(zeroes.length).toBe(21);
    expect(zeroes[1]).not.toBe(0n);
  });

  it("computes root for leaf at index 0", async () => {
    const recipientId = await recipientIdFromAddress(TEST_PAYEE_G);
    const leaf = await commitmentFromPayeeAddress(TEST_PAYEE_G, 100n, 42n);
    expect(leaf.length).toBe(32);
    const root = await rootForLeafAtIndex(leaf, 0);
    expect(root.length).toBe(32);
    expect(recipientId).toBeGreaterThan(0n);
  });

  it("produces stable commitment hex for a payee address", async () => {
    const leaf = await commitmentFromPayeeAddress(TEST_PAYEE_G, 100n, 42n);
    expect(bytesToHex(leaf)).toMatch(/^[0-9a-f]{64}$/);
  });
});
