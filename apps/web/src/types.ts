export interface StoredNote {
  payeeAddress: string;
  pubkeyLo: string;
  pubkeyHi: string;
  recipientId: string;
  amount: string;
  salt: string;
  privKey: string;
  leafIndex: number;
  batchRootHex: string;
  pathSiblings: string[];
  pathBits: string[];
}
