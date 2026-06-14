# Demo video checklist (2–3 min)

**Recommended:** Testnet + browser-only recording. See [DEMO_UI.md](./DEMO_UI.md).

## One-time prep (before recording)

- [ ] `pnpm toolchain:install` + `pnpm circuit:build`
- [ ] Stellar CLI + `stellar keys add distributor`
- [ ] `pnpm demo:prep` (builds WASM, copies circuit JSON, deploys, writes `apps/web/.env.local`)
- [ ] `pnpm dev` — verify http://localhost:3000 loads

## Wallets (Freighter — never commit secrets)

- [ ] Company wallet funded on Testnet
- [ ] Employee wallet matches a payee address in the batch

## Recording script (UI only — no terminal)

1. **Setup** — Connect Freighter; confirm pool/token IDs from `.env.local`
2. **Distributor** — Build commitments → Deposit → Finalize (ZK sum proof in browser, ~1–2 min)
3. **Explorer** — Show commitment events (hashes only, no amounts)
4. **Employee** — Trustline (once) → Generate proof & withdraw
5. **Explorer** — Show payout (recipient visible, not linked to batch index on-chain)
6. **Auditor** — Verify revealed leaf matches prepared commitment

## Cost measurement (optional, pre-demo)

```bash
MEASURE_COSTS=1 cargo test -p vellum_pool --release --features circuit-artifacts
```

Document withdraw verification cost in README.
