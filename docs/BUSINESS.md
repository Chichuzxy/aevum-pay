# AevumPay — business case in one page

Every number below is either measured on QDay Aevum testnet (chain 44005) or explicitly labelled
as an assumption. Evidence: `evidence/x402-*.jsonl`, `02_链上记录`.

## 1. The unit economics that make this possible

| quantity | measured value |
| --- | --- |
| settlement gas for one metered charge | 90,932 gas (88,666 after the first write) |
| gas price observed on 44005 | 1.125 gwei |
| cost per settlement | **≈1.08e-4 tQDAY** |
| calls per 1 tQDAY of gas | **≈9,200** |
| block interval | 1,000 ms (block timestamps), explorer reports ≤1.01 s confirmation |
| merchant-side verification | 171–190 ms |

Card rails cannot do this. Stripe charges 2.9% + $0.30 per transaction; on a $0.01 API call that
is **3,000%** of the payment. Even a $1.00 purchase pays 33% in fixed fees. Prepaid credit balances
avoid the fee but move the ledger into one vendor's database: the buyer cannot audit it and the
seller cannot prove revenue.

AevumPay settles the call itself, at a marginal cost that rounds to zero, and leaves a receipt
anyone can verify.

## 2. Who pays, and for what

| buyer | what they buy | why now |
| --- | --- | --- |
| AI API vendors (inference, OCR, TTS, search) | per-request billing without building a ledger | their customers already pay per token; invoices lag usage by weeks |
| agent platforms / marketplaces | a budget primitive agents cannot exceed | agents are given keys today with no spend ceiling |
| GPU / compute marketplaces | per-second settlement with receipts | prepaid credits + monthly true-up is the norm |
| anyone selling data by the row | metered access with an on-chain audit trail | chargebacks and reconciliation dominate support cost |

## 3. How it earns

1. **Settlement fee** — 0.3–0.5% of metered volume, charged by the merchant in the same currency.
   At 1e-4 tQDAY per settlement of 0.01 tUSD8, gas is ~1% of the fee at today's gas price.
2. **Merchant dashboard (SaaS)** — reconciliation, CSV export, per-card revenue, alerts. The demo
   dashboard is the seed of this product.
3. **SDK / white-label** — `@aevum-pay/sdk` is MIT today; a hosted relay, webhooks and multi-merchant
   accounts are the paid layer.

## 4. Honest limits

- The inference in the demo is a deterministic stub; **the payment rail is real**, the model is not.
- One merchant, one resource, one card in the demo. No multi-tenant auth, no webhook retries, no SLA.
- Replay protection for a submitted receipt is in-memory on the merchant side plus the token's nonce
  on-chain; a restarting merchant would re-verify a tx it had already served.
- Latency numbers in this repo are chain-derived. Wall-clock on this machine includes a VPN path to
  the RPC and is not representative.
- tQDAY has no market price. Cost-per-call is quoted in tQDAY; any USD figure is an assumption
  (at $0.01 per tQDAY, a settlement costs **$0.00000108**).

## 5. Roadmap after the hackathon

| window | next step |
| --- | --- |
| 30 days | ERC-4337 session keys so the card's spender is a smart-account module, not a raw key; webhook + persistent receipt store |
| 60 days | multi-merchant accounts, refunds/chargebacks as on-chain credits, dashboard auth |
| 90 days | mainnet (QDay launches February), x402-compatible client shipped as an npm package other agents can install |

## 6. The one sentence judges can repeat

**One metered API call settles in one block for ~1.08e-4 tQDAY — about 9,200 paid calls per tQDAY,
with a receipt the merchant can verify in 180 ms.**
