import type { StoredNote } from "./types";

const SESSION_KEY = "vellum-payroll-session";
const LEGACY_NOTES_KEY = "vellum-notes";

export interface PayrollSession {
  poolId: string;
  tokenId: string;
  notes: StoredNote[];
}

export function loadPayrollSession(poolId: string): PayrollSession | null {
  if (!poolId) return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    if (localStorage.getItem(LEGACY_NOTES_KEY)) {
      localStorage.removeItem(LEGACY_NOTES_KEY);
    }
    return null;
  }
  try {
    const session = JSON.parse(raw) as PayrollSession;
    if (session.poolId === poolId && Array.isArray(session.notes)) {
      return session;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function savePayrollSession(session: PayrollSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(LEGACY_NOTES_KEY);
}

export function clearPayrollSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_NOTES_KEY);
}

/** Salts / keys are assigned by row index at Prepare time — must stay in sync with App.tsx. */
export function noteSecretsForLeafIndex(leafIndex: number): { salt: bigint; privKey: bigint } {
  return { salt: BigInt(42 + leafIndex), privKey: BigInt(7 + leafIndex) };
}
