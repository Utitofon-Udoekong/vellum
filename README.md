# Vellum

Confidential payroll distribution on **Stellar Soroban** (Protocol 26) using **Noir** zero-knowledge proofs verified on-chain with **UltraHonk**.

Public blockchains expose who gets paid and how much. Vellum lets organizations run payroll on-chain while keeping individual salaries private: only **commitment hashes** go on-chain; recipients and amounts stay hidden until an employee chooses to withdraw.

## What it does

Three roles interact with one **payroll pool** contract:

| Role | Actions |
|------|---------|
| **Company** | Build a pay batch, deposit commitment hashes, prove batch solvency, lock the Merkle root |
| **Employee** | Prove entitlement with a ZK withdraw proof and receive token payout to their wallet |
| **Auditor** | Off-chain, recompute a commitment from revealed leaf data and check it matches on-chain events |

End-to-end flow:

```
Company  → Prepare (local) → Deposit(commitment) × N → Finalize(total, batch_sum_proof)
Employee → Trustline → Withdraw(public_inputs, withdraw_proof) → token payout
Auditor  → Reveal leaf off-chain → verify hash matches deposit event
```

**On-chain contracts**

- `contracts/verifier` (`vellum_verifier`) — UltraHonk verifier; deploy **twice** (withdraw VK + batch_sum VK)
- `contracts/soroban-v26` (`vellum_pool`) — Poseidon2 Merkle tree, token escrow, nullifier map

**ZK circuits**

- `circuits/withdraw` — Merkle inclusion + nullifier + **recipient binding** (depth 20, **128-byte** public inputs: `root | nullifier_hash | amount | recipient_id`)
- `circuits/batch_sum` — proves `sum(amounts) == total` (up to 8 slots)

Proofs are generated **in the browser** (Noir WASM + Barretenberg). Private witness data (amounts, salts, Merkle paths) never leaves the client except inside the proof.

## Security model

- **Batch root binding** — withdraw proofs must match the finalized Merkle root stored on-chain.
- **Recipient binding** — `recipient_id = Poseidon2(pubkey_lo, pubkey_hi)` is a public input; the contract derives it from the tx signer and rejects mismatches before verifying the proof. A stolen proof cannot be replayed by another address.
- **Nullifier** — each leaf can withdraw once; nullifier is set before token transfer (checks-effects-interactions).
- **Batch solvency** — finalize requires a ZK proof that deposited commitments sum to the escrowed total.

## Privacy model

| Stage | Public on-chain | Hidden |
|-------|-----------------|--------|
| `deposit` | commitment hash, leaf index | recipient, amount, salt |
| `finalize_batch` | total, Merkle root, count | individual amounts |
| `withdraw` | nullifier, amount, `recipient_id` (in proof); payee = tx signer (must match `recipient_id`) | link to leaf index / path; other employees' pay |
| Auditor reveal | — (off-chain) | all other employees' pay |

## Prerequisites

| Tool | Version / notes |
|------|-----------------|
| Node.js + pnpm | For the web app and scripts |
| Rust + `wasm32v1-none` target | Contract build and tests |
| Noir + Barretenberg | `1.0.0-beta.9` / `0.87.0` — see [Toolchain](#toolchain) |
| Stellar CLI | `^3.2.0` — for testnet/local deploy |
| Freighter | Browser wallet for demo UI |
| Docker | Optional — local Stellar network |
| WSL (Windows only) | Required for Noir/Barretenberg (`bb` has no native Windows build) |

## Quick start (testnet demo)

This is the path for hackathon demos and first-time reviewers.

### 1. One-time setup

```bash
pnpm install
rustup target add wasm32v1-none
pnpm toolchain:install   # WSL: installs noirup + bbup pinned versions
```

Create a funded Stellar testnet key for the company wallet:

```bash
stellar keys add distributor
stellar keys fund distributor --network testnet
```

Install [Freighter](https://www.freighter.app/) and import or create accounts for the company and at least one employee payee.

### 2. One-time demo prep

Build circuits, contracts, browser prover artifacts, and deploy to testnet:

```powershell
pnpm demo:prep
```

This runs:

1. `pnpm circuit:build` (WSL) if VKs are missing
2. `cargo build` for verifier + pool WASM
3. Copy circuit JSON into `apps/web/public/` for browser proving
4. `scripts/deploy-testnet.ps1` — deploys VELLUM SAC token, both verifiers, and the pool; writes `apps/web/.env.local`

If Stellar CLI is not installed, `demo:prep` still builds artifacts and prints manual deploy steps. You can paste contract IDs into `apps/web/.env.local` (see [Environment](#environment)).

### 3. Run the UI

```bash
pnpm dev
```

Open **http://localhost:3000**. All demo steps below happen in the browser — no terminal during recording.

### 4. Demo walkthrough

**Company tab**

1. **Connect** — link the company/distributor Freighter account (must match the deploy `distributor` key or hold the pool admin role).
2. **New payroll session** (optional) — while the dev server is running, deploys a fresh testnet pool from the UI. Otherwise use the pool ID from `demo:prep`.
3. **Prepare** — enter payee Stellar addresses and amounts (or import CSV). Builds commitments locally; nothing hits chain yet. Payee secrets are saved in this browser's session storage.
4. **Deposit** — posts each commitment hash on-chain (one Freighter approval per payee).
5. **Finalize** — browser generates a batch-sum ZK proof (~1–2 min), then one Freighter approval locks the batch.

**Employee tab**

1. Use the **same browser** where the company prepared the batch (session holds Merkle paths and salts).
2. **Connect** the payee wallet that matches a row from Prepare.
3. **Trustline** — one approval to accept the payout token.
4. **Withdraw** — browser generates a withdraw ZK proof (~1–2 min), then one Freighter approval; tokens transfer to the signer.

**Audit tab**

1. Select a payee row from the saved batch.
2. **Verify** — recompute the commitment from revealed leaf fields and confirm it matches an on-chain deposit.

**Tips**

- Keep the browser tab open while proofs generate.
- On-chain data alone cannot recover payee rows; employees need the same browser session (or exported session data) used at Prepare time.
- For a clean re-run: **New payroll session** or re-run `pnpm demo:prep` and update pool/token IDs in settings (`···`). Redeploy is required after circuit or pool contract changes (new withdraw VK + pool).

## Local development

### Toolchain

```bash
pnpm toolchain:install
```

Pins Noir `1.0.0-beta.9` and Barretenberg `0.87.0` (`oracle_hash keccak`). On Windows, this runs inside WSL.

| Tool | Version |
|------|---------|
| Noir | `1.0.0-beta.9` |
| Barretenberg | `0.87.0` |
| Soroban SDK | `26.0.1` |
| Stellar CLI | `^3.2.0` |
| Rust target | `wasm32v1-none` |

### Build circuits

```bash
pnpm circuit:build
```

Runs `nargo compile` + `bb write_vk` for both circuits via WSL. Outputs land in `circuits/*/target/`.

### Build and test contracts

```bash
pnpm contract:build
pnpm contract:test
pnpm contract:test:full   # integration tests with real VK/proof artifacts
```

### Localnet

UltraHonk verification is CPU-heavy — use unlimited resource limits:

```bash
docker run -d -p 8000:8000 stellar/quickstart --local --limits unlimited --enable core,rpc,lab,horizon,friendbot
```

Deploy to localnet (after `circuit:build` + `contract:build`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

Copy printed contract IDs into `apps/web/.env.local` with `VITE_STELLAR_NETWORK=local` and `VITE_STELLAR_RPC_URL=http://localhost:8000/soroban/rpc`.

### Full local E2E

```bash
just e2e
# or: pnpm circuit:build && pnpm contract:test:full && pnpm contract:build && powershell -File scripts/e2e_local.ps1
```

## Environment

`apps/web/.env.local` (created by `demo:prep` or copy from `apps/web/.env.example`):

```env
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_POOL_CONTRACT_ID=
VITE_TOKEN_CONTRACT_ID=
```

Leave pool/token empty to enter them manually in the UI settings panel.

## Project layout

```
circuits/withdraw/          Withdraw ZK circuit (Merkle + nullifier)
circuits/batch_sum/         Batch solvency circuit
contracts/verifier/         UltraHonk verifier WASM
contracts/soroban-v26/      VellumPool — Merkle tree, escrow, nullifiers
apps/web/                   React demo UI (Freighter, in-browser proving)
scripts/demo-prep.ps1       One-shot testnet demo setup
scripts/deploy-testnet.ps1  Testnet token + verifier + pool deploy
```

## References

Official Stellar:

- [ZK Proofs on Stellar](https://developers.stellar.org/docs/build/apps/zk)
- [Privacy on Stellar](https://developers.stellar.org/docs/build/apps/privacy)

Implementations this repo follows:

- [NethermindEth/rs-soroban-ultrahonk](https://github.com/NethermindEth/rs-soroban-ultrahonk) — verifier layout, proof size (14592 B), VK size (1760 B)
- [Noir on Stellar (James Bachini)](https://jamesbachini.com/noir-on-stellar/) — E2E prove → deploy VK → verify

## License

MIT
