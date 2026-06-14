/** Stellar SAC amounts are i128 stroops (10^decimals per whole token). */

export const DEFAULT_TOKEN_DECIMALS = 7;

export function parseHumanAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Amount required");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Invalid amount");
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Use at most ${decimals} decimal places`);
  }
  const fracPadded = fracPart.padEnd(decimals, "0");
  const combined = `${wholePart}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return BigInt(combined || "0");
}

export function formatTokenAmount(stroops: bigint, decimals: number): string {
  if (stroops === 0n) return "0";
  const div = 10n ** BigInt(decimals);
  const whole = stroops / div;
  const frac = stroops % div;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function tryParseHumanAmount(input: string, decimals: number): bigint | null {
  try {
    return parseHumanAmount(input, decimals);
  } catch {
    return null;
  }
}
