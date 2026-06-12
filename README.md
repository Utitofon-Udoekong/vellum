# Vellum

Confidential payroll distribution on Stellar Soroban using Noir (UltraHonk) zero-knowledge proofs.

Organizations deposit **commitment hashes** on-chain (recipient and amounts stay hidden), prove **batch solvency** at finalize, and employees **withdraw** with ZK inclusion + nullifier proofs.

## Architecture

```
Distributor → deposit(commitment) × N → finalize_batch(total, sum_proof)
Employee    → withdraw(employee, public_inputs, proof) → USDC payout to signer
Auditor     → off-chain leaf reveal → verify commitment matches on-chain event
```

Two Soroban contract crates:

- **`contracts/verifier`** (`vellum_verifier`) — UltraHonk verifier; deploy ×2 (withdraw + batch_sum VKs)
- **`contracts/soroban-v26`** (`vellum_pool`) — Merkle tree, escrow, nullifier map

## Toolchain

| Tool | Version |
|------|---------|
| Noir | `1.0.0-beta.9` (`noirup -v 1.0.0-beta.9`) |
| Barretenberg | `0.87.0` (`bbup -v 0.87.0`) |
| Soroban SDK | `26.0.1` |
| Stellar CLI | `^3.2.0` |
| Rust target | `wasm32v1-none` |

## References

Start here (official):

- [ZK Proofs on Stellar](https://developers.stellar.org/docs/build/apps/zk)
- [Privacy on Stellar](https://developers.stellar.org/docs/build/apps/privacy)
- [ZK Proofs skill](https://skills.stellar.org/skills/zk-proofs/SKILL.md)

Reference implementations this repo follows:

- [NethermindEth/rs-soroban-ultrahonk](https://github.com/NethermindEth/rs-soroban-ultrahonk) — verifier + mixer Merkle tree
- [Noir on Stellar (James Bachini)](https://jamesbachini.com/noir-on-stellar/) — E2E prove → deploy VK → verify

## Quick start

**Windows:** use WSL for Noir/Barretenberg (no native `bb`).

```bash
# Toolchain (WSL — Noir already installed if you ran this once)
pnpm toolchain:install

rustup target add wasm32v1-none
pnpm install

# Circuits (nargo + bb in WSL)
pnpm circuit:build

# Contracts
pnpm contract:test
pnpm contract:test:full   # after circuit artifacts exist

# Localnet (CPU-heavy proofs need unlimited limits)
docker run -d -p 8000:8000 stellar/quickstart --local --limits unlimited --enable core,rpc,lab,horizon,friendbot

# Web demo
pnpm dev
```

## Privacy model

| Stage | Public on-chain | Hidden |
|-------|-----------------|--------|
| `deposit` | commitment hash, index | recipient, amount, salt |
| `finalize_batch` | total, root, count | individual amounts |
| `withdraw` | nullifier, amount (in proof); payee = tx signer | pubkey, link to leaf index / path |
| Auditor reveal | — (off-chain) | other employees' pay |

## Circuits

- `circuits/withdraw/` — Merkle inclusion + nullifier (depth 20, 96-byte public inputs)
- `circuits/batch_sum/` — `sum(amounts) == total` (8 slots)

Build: `pnpm circuit:build`

## Contracts

- `contracts/verifier/` — UltraHonk wrapper (deploy ×2 for withdraw + batch_sum VKs)
- `contracts/soroban-v26/src/merkle.rs` — Poseidon2 frontier tree (from rs-soroban-ultrahonk mixer)
- `contracts/soroban-v26/src/contract.rs` — VellumPool

Test: `pnpm contract:test`  
Full (with ZK artifacts): `pnpm contract:test:full`

## Hackathon demo (Testnet, UI-only recording)

Run terminal **once** before recording; the browser handles deposits, ZK proofs, and withdraws.

```powershell
pnpm demo:prep    # circuits + WASM + testnet deploy → apps/web/.env.local
pnpm dev          # http://localhost:3000
```

Full walkthrough: [docs/DEMO_UI.md](docs/DEMO_UI.md) · checklist: [docs/DEMO_CHECKLIST.md](docs/DEMO_CHECKLIST.md)

## License

MIT
