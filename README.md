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
   Two settlement paths share the same checks:
   - `charge` — approve + transferFrom (2 txs, payer pays gas);
   - `chargeWithAuthorization` — **gasless**: the payer signs an EIP-3009
     `ReceiveWithAuthorization` (tUSD8 supports it), the agent submits it, and the
     payer needs zero gas. The nonce is `keccak256(address(this), cardId, amount, salt)`,
     so a signature can never be replayed onto another card, price or merchant.
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

## Deployed (QDay Aevum testnet, chain 44005)

| | |
| --- | --- |
| AevumPay v2 (EIP-3009 gasless) | `0x6728d94b8e24960556f5a731761974a1774c3abe` |
| deploy tx | `0xc9bb01135d4f738ad85ed0d6e8cd6b6653eb83189f06472bb7ef41c266230a7c` (block 3326369, gas 744,129) |
| AevumPay v1 (approve only, superseded) | `0x41be9eb9035a25bd3869c30eeee6989e5c68830e` |

## Aevum specifics (from the official starter kit)

- **Shanghai EVM**: no `MCOPY`/`TSTORE`/blob opcodes. `evm_version = "shanghai"` is pinned;
  the kit's `check-shanghai.mjs` reports both bytecode blobs Shanghai-safe.
- `eth_getLogs` is capped at 1,000 blocks → chunk log scans from the deploy block.
- No WebSocket RPC → poll over HTTPS.
- Explorer source verification is not open yet → this repo + the tx above are the evidence.
- Legacy (type 0) transactions work; the kit's scripts send `--legacy`.

## Status

v2 deployed: session cards, metered charges (approve + EIP-3009 gasless), on-chain
receipts; 10/10 Foundry tests. Next: agent-side 402 quote/challenge client,
merchant dashboard reading `Charged` events, 2-3 min demo video.
