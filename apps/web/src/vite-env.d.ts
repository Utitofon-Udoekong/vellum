/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POOL_CONTRACT_ID?: string;
  readonly VITE_TOKEN_CONTRACT_ID?: string;
  readonly VITE_STELLAR_RPC_URL?: string;
  readonly VITE_STELLAR_NETWORK_PASSPHRASE?: string;
  readonly VITE_STELLAR_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
