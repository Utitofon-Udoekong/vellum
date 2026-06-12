import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  isConnected,
  isAllowed,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "../demo-config";

export interface FreighterWallet {
  address: string | null;
  connecting: boolean;
  available: boolean | null;
  connect: () => Promise<string>;
  signTx: (xdr: string) => Promise<string>;
  disconnect: () => void;
}

export function useFreighter(): FreighterWallet {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const allowed = await isAllowed();
        setAvailable(!allowed.error);
        if (allowed.isAllowed) {
          const { address: addr } = await getAddress();
          if (addr) setAddress(addr);
        }
      } catch {
        setAvailable(false);
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        const access = await requestAccess();
        if (access.error) throw new Error(access.error);
      }
      const { address: addr, error } = await getAddress();
      if (error || !addr) throw new Error(error ?? "Freighter did not return an address");
      setAddress(addr);
      return addr;
    } finally {
      setConnecting(false);
    }
  }, []);

  const signTx = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error("Connect Freighter first");
      const { signedTxXdr, error } = await signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });
      if (error || !signedTxXdr) throw new Error(error ?? "Transaction not signed");
      return signedTxXdr;
    },
    [address],
  );

  const disconnect = useCallback(() => setAddress(null), []);

  return { address, connecting, available, connect, signTx, disconnect };
}
