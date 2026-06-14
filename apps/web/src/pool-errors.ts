/** Maps on-chain PoolError codes from contracts/soroban-v26/src/contract.rs */
const POOL_ERROR_NAMES: Record<number, string> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "Unauthorized",
  4: "BatchFinalized",
  5: "BatchNotFinalized",
  6: "CommitmentExists",
  7: "TreeFull",
  8: "InvalidPublicInputs",
  9: "NullifierUsed",
  10: "RootMismatch",
  11: "VerificationFailed",
  12: "VerifierNotSet",
  13: "TotalMismatch",
  14: "InsufficientEscrow",
  15: "InvalidAmount",
  16: "InvalidRecipient",
};

export function poolErrorCode(error: unknown): number | null {
  const msg = error instanceof Error ? error.message : String(error);
  const match = msg.match(/Error\(Contract,\s*#(\d+)\)/);
  return match ? Number(match[1]) : null;
}

export function isCommitmentExistsError(error: unknown): boolean {
  return poolErrorCode(error) === 6;
}

export function isBatchFinalizedError(error: unknown): boolean {
  return poolErrorCode(error) === 4;
}

export function describePoolContractError(error: unknown): string | null {
  const code = poolErrorCode(error);
  if (code === null) return null;
  const name = POOL_ERROR_NAMES[code] ?? `ContractError#${code}`;
  if (code === 6) {
    return `${name}: this commitment is already on chain. Skip Deposit and go to Finalize, or Prepare again with new payees/salts.`;
  }
  if (code === 4) {
    return `${name}: batch is already finalized on this pool. Skip Deposit — switch to Employee tab to withdraw, or deploy a fresh pool for a new payroll.`;
  }
  if (code === 11) {
    return `${name}: ZK proof did not verify. Try Finalize again after a hard refresh; if it persists, run pnpm demo:copy-circuits and redeploy verifiers.`;
  }
  return `${name} (pool contract error #${code})`;
}
