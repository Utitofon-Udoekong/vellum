# UI-only demo guide

Run terminal commands **once before** your recording. During the demo, use only the browser.

## Before the demo (one-time)

```powershell
# 1. Toolchain + circuits (if not done)
pnpm toolchain:install
pnpm circuit:build

# 2. Install Stellar CLI + add your distributor key (prompts for secret locally)
cargo install --locked stellar-cli
stellar keys add distributor

# 3. Full prep: build, copy circuits, deploy testnet, write .env.local
pnpm demo:prep
```

## Wallets in the UI (Freighter — no pasted secrets)

| Role | Freighter account | Notes |
|------|-------------------|--------|
| Company / distributor | Your wallet #1 (`GDNKKY4K…`) | Funds pool, deposits, finalize |
| Employee / payee | Any funded Freighter account | Must match the address HR entered in the batch row; payout goes to the connected signer |

## Start the demo

```powershell
pnpm dev
```

Open http://localhost:3000

1. **Connect Freighter** as Company (wallet #1) and as Employee (the payee address from the batch)
2. Pool / token IDs load from `.env.local` automatically
3. **Company flow:** Build commitments → Deposit → Finalize (proof runs in browser)
4. **Employee flow:** Trustline (once) → Generate proof & withdraw (Freighter signs)
5. **Auditor:** Verify revealed leaf

No terminal during the recording.
