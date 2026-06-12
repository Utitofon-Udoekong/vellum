import {
  Address,
  Contract,
  Keypair,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "./demo-config";

async function submitPreparedTx(
  server: rpc.Server,
  signedXdr: string,
): Promise<string> {
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.sendTransaction(signed);
  if (result.status !== "PENDING") {
    throw new Error(`Transaction failed: ${result.status} ${JSON.stringify(result)}`);
  }

  let getResp = await server.getTransaction(result.hash);
  let waited = 0;
  while (getResp.status === "NOT_FOUND" && waited < 180_000) {
    await new Promise((r) => setTimeout(r, 2000));
    waited += 2000;
    getResp = await server.getTransaction(result.hash);
  }
  if (getResp.status !== "SUCCESS") {
    throw new Error(`Transaction ${result.hash} failed: ${getResp.status}`);
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
  return submitPreparedTx(server, tx.toXDR());
}

/** Sign with Freighter (or any wallet) instead of a local secret key. */
export async function invokeContractWallet(
  publicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  signXdr: (xdr: string) => Promise<string>,
): Promise<string> {
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

  tx = await server.prepareTransaction(tx);
  const signedXdr = await signXdr(tx.toXDR());
  return submitPreparedTx(server, signedXdr);
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
