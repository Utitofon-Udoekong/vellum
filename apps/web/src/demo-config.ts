/** Public demo configuration — safe to commit. Secrets stay in the UI session only. */

export const DISTRIBUTOR_G =
  "GDNKKY4KRFAUAMCG4AFIUZT3I2PFWB34GG2DWF6O2BZYE2L2ZWCMXLPR";

/** Default demo payee — any Freighter G-address works with hash(pubkey) leaves. */
export const DEMO_EMPLOYEE_G =
  "GAL7PHYRX7GOTU52FOHMUIOYD3JXU6UUE5Q65YQJZBEAF4NZFWI2XGHX";

export const DEFAULT_POOL_ID = import.meta.env.VITE_POOL_CONTRACT_ID ?? "";
export const DEFAULT_TOKEN_ID = import.meta.env.VITE_TOKEN_CONTRACT_ID ?? "";

export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export const NETWORK_LABEL = import.meta.env.VITE_STELLAR_NETWORK ?? "testnet";
