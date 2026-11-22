# @aevum-pay/sdk

Client helpers for **AevumPay** on QDay Aevum testnet (chainId `44005`, tUSD8).
Use it to give an agent a budget, let it pay per unit, and reconcile what was spent.

```bash
npm i viem aevum-pay-sdk
```

> Publishing: `npm login` then `bash scripts/publish-sdk.sh` (add `--dry` to only validate).
> Until then the package is importable straight from this repo: `import { createAevumPay } from "./sdk/src/index.js"`.

## What it gives you

| helper | what it does |
| --- | --- |
| `createAevumPay({ rpcUrl, contract, token })` | client over viem; defaults to the deployed v2 contract |
| `pay.quote(resourceId)` | merchant, unit price and active flag for a resource |
| `pay.openCard(wallet, {...})` | approve + `createCard`, returns the derived `cardId` |
| `pay.prepareGasless({...})` | quote the price and have the **payer sign offline** (EIP-3009) |
| `pay.chargeWithAuthorization(wallet, {...})` | agent broadcasts the payer's signature and pays gas |
| `pay.charge(wallet, {...})` | classic approve + `transferFrom` path |
| `pay.revokeCard(wallet, cardId)` | payer cuts the card off immediately |
| `pay.refund(wallet, cardId, amount, reason)` | merchant returns tUSD8 and re-opens the card's budget |
| `pay.openAnyMerchantCard(wallet, {...})` | a card any listed merchant may charge |
| `pay.receipts({ fromBlock, cardId })` | `Charged` receipts, walking `eth_getLogs` in 1,000-block chunks |
| `pay.card(cardId)` / `pay.remaining(cardId)` | cap, spent, expiry, revoked |

Pure helpers are exported too: `computeCardId`, `authorizationNonce`,
`domainSeparator`, `tokenDomain`, `TUSD8_DOMAIN`, `MAX_LOG_RANGE`.

## Agent pays, payer signs

```js
import { privateKeyToAccount } from "viem/accounts";
import { createAevumPay, EXPLORER } from "@aevum-pay/sdk";

const payer = privateKeyToAccount(process.env.PAYER_KEY);
const agent = privateKeyToAccount(process.env.AGENT_KEY);
const pay = createAevumPay(); // 44005 defaults

const resourceId = pay.resourceId("api.infer.small");
const price = (await pay.quote(resourceId)).unitPrice; // 0.01 tUSD8 = 10000

// 1. payer opens a 0.05 tUSD8 budget for this merchant, valid for a day
const salt = BigInt(Date.now());
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const { cardId } = await pay.openCard(payer, {
  spender: agent.address, merchant: agent.address, cap: 50_000n, expiry, salt,
});

// 2. agent gets a quote, payer signs off-chain (no gas, no transaction)
const { amount, auth } = await pay.prepareGasless({
  payerAccount: payer, cardId, resourceId, units: 3n, salt,
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

// 3. agent settles and pays gas
const receipt = await pay.chargeWithAuthorization(agent, {
  cardId, resourceId, units: 3n, auth,
  receiptHash: "0x…your own receipt id…",
});
console.log(EXPLORER + "/tx/" + receipt.transactionHash);
```

## Notes on this chain

- **Shanghai EVM**: no `MCOPY`/`TSTORE`/blob opcodes. `evm_version = "shanghai"` is pinned in
  `foundry.toml`; `tools/check-shanghai.mjs` (from the official starter kit) reports both blobs safe.
- **`eth_getLogs` is capped at 1,000 blocks** — `pay.receipts()` chunks for you. Store the deploy
  block and start there.
- **No WebSocket RPC** — viem's HTTP transport polls.
- **Legacy transactions** are used explicitly (`type: "legacy"` + `gasPrice`), which is what QDay
  itself and the starter kit send.
- **EIP-3009 domain**: `name "tUSD8"`, `version "2"`, chainId `44005`, verifyingContract = token.
  `domainSeparator()` must equal the token's on-chain `DOMAIN_SEPARATOR` (it does; the demo asserts it).

## Tests

```bash
npm run test:sdk        # pure helpers: cardId / nonce / domain separator determinism
npm run test:contracts  # forge test — 10 tests, 4 of them gasless
```
