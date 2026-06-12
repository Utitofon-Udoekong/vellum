export async function loadWithdrawCircuit(): Promise<object> {
  const res = await fetch("/circuits/vellum_withdraw.json");
  if (!res.ok) {
    throw new Error("Missing /circuits/vellum_withdraw.json — run: pnpm demo:setup");
  }
  return res.json();
}

export async function loadBatchSumCircuit(): Promise<object> {
  const res = await fetch("/circuits/vellum_batch_sum.json");
  if (!res.ok) {
    throw new Error("Missing /circuits/vellum_batch_sum.json — run: pnpm demo:setup");
  }
  return res.json();
}
