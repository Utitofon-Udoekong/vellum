import { describe, expect, it } from "vitest";
import { parsePayrollCsv, sumAmounts, newBatchRow } from "./payroll";

describe("payroll", () => {
  it("parses csv rows", () => {
    const csv = `address,amount
GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX,100
GCOZFZHWB6CEVXWHUR7P7RJJSFR2USUCEKVAP7BTUMWPC77VMXYXCIRR,250`;
    const rows = parsePayrollCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe("100");
    expect(rows[1].amount).toBe("250");
  });

  it("sums amounts", () => {
    const total = sumAmounts([
      newBatchRow({ amount: "100" }),
      newBatchRow({ amount: "250" }),
    ]);
    expect(total).toBe(350n);
  });
});
