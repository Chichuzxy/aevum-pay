// Smoke test for the data paths the web UI uses (no DOM, no browser).
//   node scripts/web-smoke.mjs
import { createAevumPay, authorizationNonce, tokenDomain, computeCardId } from "../sdk/src/index.js";
import { formatUnits } from "viem";

const DEPLOY_BLOCK = 3326369n;
const pay = createAevumPay();

const resourceId = pay.resourceId("api.infer.small");
const quote = await pay.quote(resourceId);
console.log("quote       ", quote.merchant, formatUnits(quote.unitPrice, 6), "tUSD8/unit, active =", quote.active);

const receipts = await pay.receipts({ fromBlock: DEPLOY_BLOCK });
console.log("receipts    ", receipts.length, "total", formatUnits(receipts.reduce((s, r) => s + r.amount, 0n), 6), "tUSD8");

const last = receipts.at(-1);
if (last) {
  const card = await pay.card(last.cardId);
  console.log("last card   ", {
    cap: formatUnits(card.cap, 6),
    spent: formatUnits(card.spent, 6),
    remaining: formatUnits(card.remaining, 6),
    revoked: card.revoked,
  });
  const block = await pay.publicClient.getBlock({ blockNumber: last.blockNumber });
  console.log("block time  ", new Date(Number(block.timestamp) * 1000).toISOString());
}

// The UI derives cardIds locally before createCard returns, so it must match the contract.
const salt = 1794838244n;
const derived = computeCardId({
  payer: "0xdb03374034ca16Afe997038266886327d1efd3af",
  spender: "0x87c104C83f061489a8bbd9FC9bEcadE58E52685F",
  merchant: "0x87c104C83f061489a8bbd9FC9bEcadE58E52685F",
  cap: 50_000n,
  expiry: 1_794_922_044n,
  salt,
});
console.log("cardId calc ", derived);

const nonce = authorizationNonce({ payContract: pay.contract, cardId: last?.cardId ?? derived, amount: 30_000n, salt });
const domain = tokenDomain({ token: pay.token });
const sep = await pay.tokenDomainSeparator();
console.log("nonce sample", nonce.slice(0, 12) + "…");
console.log("domain      ", domain.name, "v" + domain.version, "chain", domain.chainId, "sep", sep.slice(0, 10) + "…");
