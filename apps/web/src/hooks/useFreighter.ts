import { useCallback, useEffect, useState } from "react";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  signMessage,
  signTransaction,
  WatchWalletChanges,
} from "@stellar/freighter-api";
import { NETWORK_LABEL, NETWORK_PASSPHRASE } from "../demo-config";

const CONNECT_MESSAGE = "Connect to Vellum";

function freighterErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  return (error as { message?: string }).message ?? fallback;
}

export interface FreighterWallet {
  address: string | null;
  connecting: boolean;
  available: boolean | null;
  /** Freighter's currently selected account (may differ from `address` until Connect). */
  freighterActive: string | null;
  /** Pass `switchTo` to open Freighter and select that account (via signMessage). */
  connect: (switchTo?: string) => Promise<string>;
  signTx: (xdr: string) => Promise<string>;
  disconnect: () => void;
}

export interface UseFreighterOptions {
  /** Connect rejects unless Freighter returns exactly this G-address. */
  requiredAddress?: string;
}

export function useFreighter(options: UseFreighterOptions = {}): FreighterWallet {
  const { requiredAddress } = options;
  const [address, setAddress] = useState<string | null>(null);
  const [freighterActive, setFreighterActive] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const allowed = await isAllowed();
        setAvailable(!allowed.error);
        if (allowed.isAllowed) {
          const { address: active } = await getAddress();
          if (active) setFreighterActive(active);
        }
      } catch {
        setAvailable(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!available) return;
    const watcher = new WatchWalletChanges(2000);
    watcher.watch(({ address: active, error }) => {
      if (error || !active) return;
      setFreighterActive(active);
      setAddress((connected) => {
        if (!connected) return null;
        if (requiredAddress && active !== requiredAddress) return null;
        if (connected !== active) return active;
        return connected;
      });
    });
    return () => watcher.stop();
  }, [available, requiredAddress]);

  const assertFreighterNetwork = useCallback(async () => {
    const net = await getNetwork();
    if (net.error) {
      throw new Error(freighterErrorMessage(net.error, "Could not read Freighter network"));
    }
    if (net.networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new Error(
        `Freighter is on ${net.network ?? "another network"}. Switch to ${NETWORK_LABEL} in Freighter, then retry.`,
      );
    }
  }, []);

  const connectViaSignMessage = useCallback(
    async (targetAddress: string) => {
      await assertFreighterNetwork();

      const allowed = await isAllowed();
      if (!allowed.isAllowed) {
        const access = await requestAccess();
        if (access.error) {
          throw new Error(freighterErrorMessage(access.error, "Access denied"));
        }
      }

      const { signerAddress, error } = await signMessage(CONNECT_MESSAGE, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: targetAddress,
      });
      if (error) {
        const { address: active } = await getAddress();
        if (active) setFreighterActive(active);
        throw new Error(freighterErrorMessage(error, "Account switch cancelled"));
      }
      if (!signerAddress) throw new Error("Freighter did not return an address");

      setFreighterActive(signerAddress);

      if (requiredAddress && signerAddress !== requiredAddress) {
        setAddress(null);
        throw new Error(
          "Wrong account in Freighter. Approve the prompt for the required wallet, then try again.",
        );
      }

      setAddress(signerAddress);
      return signerAddress;
    },
    [assertFreighterNetwork, requiredAddress],
  );

  const connect = useCallback(
    async (switchTo?: string) => {
      setConnecting(true);
      try {
        const ext = await isConnected();
        if (!ext.isConnected) {
          throw new Error("Freighter extension not installed");
        }

        const target = switchTo ?? requiredAddress;
        const { address: active } = await getAddress();
        if (active) setFreighterActive(active);

        if (target && active && active !== target) {
          return await connectViaSignMessage(target);
        }

        const access = await requestAccess();
        if (access.error) {
          throw new Error(freighterErrorMessage(access.error, "Access denied"));
        }
        const addr = access.address;
        if (!addr) throw new Error("Freighter did not return an address");

        await assertFreighterNetwork();
        setFreighterActive(addr);

        if (requiredAddress && addr !== requiredAddress) {
          return await connectViaSignMessage(requiredAddress);
        }

        if (target && addr !== target) {
          return await connectViaSignMessage(target);
        }

        setAddress(addr);
        return addr;
      } finally {
        setConnecting(false);
      }
    },
    [assertFreighterNetwork, connectViaSignMessage, requiredAddress],
  );

  const signTx = useCallback(
    async (xdr: string) => {
      const { address: activeAddress, error: addrErr } = await getAddress();
      if (addrErr || !activeAddress) throw new Error("Connect Freighter first");
      setFreighterActive(activeAddress);

      const expected = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      if (!(expected instanceof Transaction)) {
        throw new Error("Unexpected fee-bump transaction from RPC.");
      }
      if (activeAddress !== expected.source) {
        throw new Error(
          `Freighter is on ${activeAddress.slice(0, 8)}…${activeAddress.slice(-4)} but this transaction requires ${expected.source.slice(0, 8)}…${expected.source.slice(-4)}. Switch accounts in Freighter, then click Connect.`,
        );
      }
      if (address && activeAddress !== address) {
        throw new Error(
          `Freighter account changed. Click Connect again (expected ${address.slice(0, 8)}…${address.slice(-4)}).`,
        );
      }

      const { signedTxXdr, signerAddress, error } = await signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: activeAddress,
      });
      if (error || !signedTxXdr) {
        console.error("[vellum] Freighter signTransaction failed", { error, activeAddress });
        throw new Error(typeof error === "string" ? error : "Transaction not signed");
      }

      const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      if (signed.signatures.length === 0) {
        throw new Error(
          "Freighter did not sign the transaction. Approve the prompt or switch to the connected account in Freighter.",
        );
      }
      if (!(signed instanceof Transaction)) {
        throw new Error("Unexpected fee-bump transaction from Freighter.");
      }
      if (signerAddress && signerAddress !== signed.source) {
        throw new Error(
          `Freighter signed as ${signerAddress}, but this transaction requires ${signed.source}.`,
        );
      }

      return signedTxXdr;
    },
    [address],
  );

  const disconnect = useCallback(() => setAddress(null), []);

  return { address, freighterActive, connecting, available, connect, signTx, disconnect };
}
