# AevumPay — metered agent payments with on-chain receipts

Aevum Builder Challenge #1 · Track: **Decentralized Payments** · QDay testnet (chainId 44005, tUSD8)

## Problem

AI agents pay for APIs and compute per request. Today each call is either a raw
`transfer` (no budget control, no invoice) or a prepaid balance inside one vendor's
database (not verifiable, not portable). Merchants cannot prove revenue; payers
cannot audit spend per session.

## What AevumPay adds

1. **Session card** — the payer opens a card bound to a merchant, a spender (the
   agent key), a spend cap and an expiry. The agent can charge only inside those
   limits; the payer can revoke at any time.
2. **Metered charge** — one on-chain call per settled batch of units; the contract
   prices the units, moves tUSD8 payer → merchant and enforces the cap.
3. **On-chain receipt** — every charge emits `Charged(... receiptHash, receiptIndex)`,
   giving an append-only, verifiable reconciliation trail for the merchant dashboard
   and the payer's audit log.

Caps here are *business* limits that sit on top of the platform's ERC-4337 session
keys (spending cap / time lock enforced by the EntryPoint), not a replacement.

## Flow

```
payer ──approve──▶ AevumPay
payer ──createCard(spender=agent, merchant, cap, expiry)──▶ AevumPay
agent ──charge(cardId, resourceId, units, receiptHash)────▶ AevumPay ──tUSD8──▶ merchant
                                                   └─ Charged event = receipt
```

## Layout

```
src/AevumPay.sol        merchant registry, priced resources, session cards, metered charge, receipts
test/AevumPay.t.sol     6 tests: metering, cap, expiry, spender auth, revoke, merchant binding
script/Deploy.s.sol     broadcast deploy (reads PRIVATE_KEY + TUSD8_ADDRESS from .env)
```

## Network

| item | value |
| --- | --- |
| chainId | 44005 |
| RPC | https://rpc-test.qday.info |
| explorer | https://explorer-test.qday.info/ |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals) |
| gas token | tQDAY |

## Run

```bash
cp .env.example .env      # fill PRIVATE_KEY yourself, never commit it
forge test -vv
forge script script/Deploy.s.sol:Deploy --rpc-url qday --broadcast
```

Deployment address and tx hash are recorded in the project's on-chain log
(`02_链上记录`) outside this repo, and in `broadcast/Deploy.s.sol/44005/`.

## Status

Contract skeleton + tests done. Next: agent-side x402-style 402 challenge client,
merchant dashboard reading `Charged` events, 2-3 min demo video.
