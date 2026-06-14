async function loadCircuitJson(path: string, label: string): Promise<object> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Missing ${path} — run: pnpm demo:copy-circuits`);
  }
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `${label} circuit not found at ${path}. Run: pnpm demo:copy-circuits`,
    );
  }
  return JSON.parse(text) as object;
}

export async function loadWithdrawCircuit(): Promise<object> {
  return loadCircuitJson("/circuits/vellum_withdraw.json", "Withdraw");
}

export async function loadBatchSumCircuit(): Promise<object> {
  return loadCircuitJson("/circuits/vellum_batch_sum.json", "Batch sum");
}
