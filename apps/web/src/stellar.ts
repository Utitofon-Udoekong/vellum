import {
  Account,
  Address,
  Contract,
  Keypair,
  rpc,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToBigInt,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "./demo-config";
import { describePoolContractError } from "./pool-errors";

type SendResult = rpc.Api.SendTransactionResponse;

function txErrorName(result: SendResult): string | undefined {
  const er = result.errorResult as Record<string, unknown> | undefined;
  if (!er) return undefined;
  const attrs = er._attributes as { result?: { _switch?: { name?: string } } } | undefined;
  if (attrs?.result?._switch?.name) return attrs.result._switch.name;
  const fn = er.result as (() => { switch?: () => { name?: string } }) | undefined;
  return fn?.()?.switch?.()?.name;
}

function describeSendError(result: SendResult, context?: string): string {
  const code = txErrorName(result);
  const hash = result.hash ? ` · tx ${result.hash.slice(0, 12)}…` : "";
  const prefix = context ? `${context}: ` : "";

  if (code === "txBadAuth") {
    return (
      `${prefix}Missing or invalid signature (txBadAuth)${hash}. ` +
      "Freighter must approve the prompt, and the active account must match the connected wallet."
    );
  }

  return `${prefix}Transaction failed (${result.status}${code ? ` · ${code}` : ""})${hash}`;
}

function assertSignedTx(signedXdr: string, expectedSource: string): void {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (tx.signatures.length === 0) {
    throw new Error(
      "Wallet returned an unsigned transaction. Approve the Freighter prompt and ensure the active account matches the connected wallet.",
    );
  }
  if (!(tx instanceof Transaction)) {
    throw new Error("Unexpected fee-bump transaction from wallet.");
  }
  if (tx.source !== expectedSource) {
    throw new Error(
      `Transaction source is ${tx.source} but the connected wallet is ${expectedSource}. Reconnect Freighter.`,
    );
  }
}

async function fetchTransactionStatus(hash: string): Promise<{
  status: string;
  diagnosticEventsXdr?: string[];
}> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vellum",
      method: "getTransaction",
      params: { hash },
    }),
  });
  if (!res.ok) throw new Error(`RPC getTransaction HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: { status?: string; diagnosticEventsXdr?: string[] };
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "getTransaction RPC error");
  if (!body.result?.status) throw new Error("getTransaction returned no status");
  return {
    status: body.result.status,
    diagnosticEventsXdr: body.result.diagnosticEventsXdr,
  };
}

function describeLedgerFailure(hash: string, diagnosticEventsXdr?: string[]): string {
  const blob = (diagnosticEventsXdr ?? []).join(" ");
  if (blob.includes("require_auth")) {
    return (
      `Transaction ${hash.slice(0, 12)}… failed: pool admin authorization missing. ` +
      "Connect the company wallet (pool admin) in Freighter, not a payee account."
    );
  }
  const poolMsg = describePoolContractError(blob);
  if (poolMsg) return `Transaction ${hash.slice(0, 12)}… failed: ${poolMsg}`;
  return `Transaction ${hash} failed on ledger`;
}

async function waitForLedgerSuccess(
  hash: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { status, diagnosticEventsXdr } = await fetchTransactionStatus(hash);
    if (status === "SUCCESS") return;
    if (status === "FAILED") {
      throw new Error(describeLedgerFailure(hash, diagnosticEventsXdr));
    }
    onStatus?.(`Waiting for ledger confirmation… (${hash.slice(0, 8)}…)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} timed out waiting for ledger confirmation`);
}

async function submitPreparedTx(
  server: rpc.Server,
  signedXdr: string,
  expectedSource: string,
  context?: string,
  onStatus?: (message: string) => void,
): Promise<string> {
  assertSignedTx(signedXdr, expectedSource);

  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.sendTransaction(signed);
  if (result.status !== "PENDING") {
    const message = describeSendError(result, context);
    console.error("[vellum] sendTransaction failed", {
      context,
      source: expectedSource,
      status: result.status,
      hash: result.hash,
      errorResult: result.errorResult,
    });
    throw new Error(message);
  }

  try {
    onStatus?.("Waiting for ledger confirmation…");
    await waitForLedgerSuccess(result.hash, onStatus);
  } catch (e) {
    console.error("[vellum] transaction confirmation failed", { context, hash: result.hash, e });
    throw e;
  }
  return result.hash;
}

export function getServer(): rpc.Server {
  return new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
}

export async function invokeContract(
  source: Keypair,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const server = getServer();
  const sourceAccount = await server.getAccount(source.publicKey());
  const contract = new Contract(contractId);

  let tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  tx = await server.prepareTransaction(tx);
  tx.sign(source);
  return submitPreparedTx(server, tx.toXDR(), source.publicKey(), `${contractId}.${method}`);
}

/** Sign with Freighter (or any wallet) instead of a local secret key. */
export async function invokeContractWallet(
  publicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  signXdr: (xdr: string) => Promise<string>,
  onStatus?: (message: string) => void,
): Promise<string> {
  const context = `${contractId}.${method}`;
  const server = getServer();
  const sourceAccount = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  let tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  onStatus?.("Building transaction…");
  console.info("[vellum] preparing contract call", { context, source: publicKey, method });
  tx = await server.prepareTransaction(tx);

  const unsignedXdr = tx.toXDR();
  onStatus?.(`Approve ${method.replace(/_/g, " ")} in Freighter…`);
  console.info("[vellum] awaiting wallet signature", { context, source: publicKey });
  const signedXdr = await signXdr(unsignedXdr);

  onStatus?.("Submitting to network…");
  const hash = await submitPreparedTx(server, signedXdr, publicKey, context, onStatus);
  return hash;
}

export function bytesScVal(bytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(bytes);
}

export function addressScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

export function i128ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

const SIMULATE_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Read-only pool view via Soroban simulation (no wallet signature). */
export async function simulateContractU32(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<number> {
  const server = getServer();
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(SIMULATE_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(typeof sim.error === "string" ? sim.error : "Contract simulation failed");
  }
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`No return value from ${method}`);
  return Number(scValToBigInt(retval));
}

/** BatchStatus: 0 = Building, 1 = Finalized */
export async function readPoolBatchStatus(poolId: string): Promise<0 | 1> {
  return (await simulateContractU32(poolId, "get_batch_status")) as 0 | 1;
}

async function simulateContractReturn(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<xdr.ScVal | undefined> {
  const server = getServer();
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(SIMULATE_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(typeof sim.error === "string" ? sim.error : "Contract simulation failed");
  }
  return sim.result?.retval;
}

function scValToBytes(val: xdr.ScVal | undefined): Uint8Array | null {
  if (!val) return null;
  const native = scValToNative(val);
  if (native == null) return null;
  if (native instanceof Uint8Array) return native;
  if (Array.isArray(native)) return Uint8Array.from(native as number[]);
  return null;
}

/** Merkle root fixed at finalize — compare to saved `batchRootHex` in browser notes. */
export async function readPoolFinalizedRoot(poolId: string): Promise<Uint8Array | null> {
  const retval = await simulateContractReturn(poolId, "get_finalized_root");
  return scValToBytes(retval);
}

export async function readPoolCommitmentCount(poolId: string): Promise<number> {
  return simulateContractU32(poolId, "commitment_count");
}

export async function readPoolTotalDeposited(poolId: string): Promise<bigint> {
  const retval = await simulateContractReturn(poolId, "total_deposited");
  if (!retval) throw new Error("Could not read total_deposited");
  return scValToBigInt(retval);
}

export async function simulateContractI128(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<bigint> {
  const retval = await simulateContractReturn(contractId, method, args);
  if (!retval) throw new Error(`No return value from ${method}`);
  return scValToBigInt(retval);
}

export async function readTokenDecimals(tokenId: string): Promise<number> {
  return simulateContractU32(tokenId, "decimals");
}

export async function readTokenBalance(tokenId: string, holder: string): Promise<bigint> {
  return simulateContractI128(tokenId, "balance", [addressScVal(holder)]);
}

export async function readTokenSymbol(tokenId: string): Promise<string> {
  const retval = await simulateContractReturn(tokenId, "symbol");
  const native = retval ? scValToNative(retval) : null;
  if (typeof native === "string" && native.length > 0) return native;
  return "TOKEN";
}
