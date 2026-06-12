import { Keypair } from "@stellar/stellar-sdk";

/** Matches `batch_sum` circuit slot count. */
export const BATCH_MAX = 8;

export interface BatchRow {
  id: string;
  payeeAddress: string;
  amount: string;
  error?: string;
}

export function newBatchRow(partial?: Partial<BatchRow>): BatchRow {
  return {
    id: crypto.randomUUID(),
    payeeAddress: "",
    amount: "100",
    ...partial,
  };
}

export function validatePayeeAddress(address: string): string | undefined {
  if (!address) return "Required";
  try {
    Keypair.fromPublicKey(address);
  } catch {
    return "Invalid G-address";
  }
  return undefined;
}

export function sumAmounts(rows: BatchRow[]): bigint {
  return rows.reduce((sum, row) => {
    const trimmed = row.amount.trim();
    if (!trimmed) return sum;
    try {
      return sum + BigInt(trimmed);
    } catch {
      return sum;
    }
  }, 0n);
}

/** Parse `address,amount` per line. Header row optional. */
export function parsePayrollCsv(text: string): BatchRow[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const rows: BatchRow[] = [];
  for (const line of lines) {
    if (/address/i.test(line) && /amount/i.test(line)) continue;

    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;

    const [payeeAddress, amount] = parts;
    if (!payeeAddress?.startsWith("G") || !amount) continue;

    rows.push(newBatchRow({ payeeAddress, amount }));
    if (rows.length >= BATCH_MAX) break;
  }
  return rows;
}
