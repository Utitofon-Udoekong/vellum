import { describe, expect, it } from "vitest";
import { buildZeroes, rootForLeafAtIndex } from "./merkle";
import { commitmentFromPayeeAddress } from "./commitment";
import { bytesToHex } from "./bytes";
import { DEMO_EMPLOYEE_G } from "./demo-config";
import { recipientIdFromAddress } from "./pubkey";

describe("merkle", () => {
  it("builds zero chain", async () => {
    const zeroes = await buildZeroes();
    expect(zeroes[0]).toBe(0n);
    expect(zeroes.length).toBe(21);
    expect(zeroes[1]).not.toBe(0n);
  });

  it("computes root for leaf at index 0", async () => {
    const recipientId = await recipientIdFromAddress(DEMO_EMPLOYEE_G);
    const leaf = await commitmentFromPayeeAddress(DEMO_EMPLOYEE_G, 100n, 42n);
    expect(leaf.length).toBe(32);
    const root = await rootForLeafAtIndex(leaf, 0);
    expect(root.length).toBe(32);
    expect(recipientId).toBeGreaterThan(0n);
  });

  it("produces stable commitment hex for demo employee", async () => {
    const leaf = await commitmentFromPayeeAddress(DEMO_EMPLOYEE_G, 100n, 42n);
    expect(bytesToHex(leaf)).toMatch(/^[0-9a-f]{64}$/);
  });
});
