#!/usr/bin/env node
// End-to-end gasless proof, written with @aevum-pay/sdk.
// The payer signs an EIP-3009 authorization off-chain; the AGENT submits it.
// During the charge the payer sends no transaction and spends no tQDAY.
//
//   npm i viem && node scripts/gasless-demo.mjs
//
// Env: .env (PRIVATE_KEY = payer), .env.demo (AGENT_PRIVATE_KEY), RPC_URL, AEVUMPAY_ADDRESS
import { readFileSync } from "node:fs";
import { keccak256, toHex, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAevumPay, domainSeparator, CHAIN_ID } from "../sdk/src/index.js";

const EXPLORER = "https://explorer-test.qday.info/tx/";
const DEPLOY_BLOCK = 3326369n; // AevumPay v2 deployment block

const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );

const env = { ...readEnv(".env"), ...readEnv(".env.demo") };
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const payer = privateKeyToAccount(key(env.PRIVATE_KEY));
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY));

const pay = createAevumPay({ rpcUrl: env.RPC_URL, contract: env.AEVUMPAY_ADDRESS, token: env.TUSD8_ADDRESS });
const { publicClient } = pay;
const tx = (rc) => `status=${rc.status} gas=${rc.gasUsed} tx=${rc.transactionHash}`;

const resourceId = keccak256(toHex("api.infer.small"));
const price = 10_000n; // 0.01 tUSD8
const units = 3n;
const cap = 50_000n;
const salt = BigInt(Math.floor(Date.now() / 1000));
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

console.log("payer", payer.address);
console.log("agent", agent.address);

// The local EIP-712 domain must match the token's on-chain separator, or every
// signature would be silently invalid.
const sep = domainSeparator({ token: pay.token, chainId: CHAIN_ID });
const onchainSep = await pay.tokenDomainSeparator();
console.log(`\nEIP-712 domain OK: ${sep.toLowerCase() === onchainSep.toLowerCase()}`);

console.log("\n== setup (payer txs: approve + createCard) ==");
console.log("  registerMerchant        ", tx(await pay.registerMerchant(agent)));
console.log("  listResource            ", tx(await pay.listResource(agent, resourceId, price)));
const opened = await pay.openCard(payer, { spender: agent.address, merchant: agent.address, cap, expiry, salt });
const cardId = opened.cardId;
console.log("  approve                 ", tx(opened.approve));
console.log("  createCard              ", tx(opened.createCard));
console.log("  cardId                  ", cardId);

// The payer signs offline. No gas, no transaction, just a signature.
const { amount, auth, nonce } = await pay.prepareGasless({
  payerAccount: payer,
  cardId,
  resourceId,
  units,
  salt,
  validBefore,
});
console.log("\npayer signed offline:");
console.log("  amount                  ", `${formatUnits(amount, 6)} tUSD8 (${units} units)`);
console.log("  nonce                   ", nonce);

const payerNonceBefore = await publicClient.getTransactionCount({ address: payer.address });
const payerGasBefore = await publicClient.getBalance({ address: payer.address });
const merchantBefore = await pay.balanceOf(agent.address);

console.log("\n== gasless charge: only the AGENT broadcasts ==");
const rc = await pay.chargeWithAuthorization(agent, {
  cardId,
  resourceId,
  units,
  receiptHash: keccak256(toHex("receipt-gasless-sdk")),
  auth,
});
console.log("  chargeWithAuthorization ", tx(rc));

const payerNonceAfter = await publicClient.getTransactionCount({ address: payer.address });
const payerGasAfter = await publicClient.getBalance({ address: payer.address });
const merchantAfter = await pay.balanceOf(agent.address);

console.log("\n== proof ==");
console.log(`payer tx count : ${payerNonceBefore} -> ${payerNonceAfter}   (unchanged = payer sent nothing)`);
console.log(`payer tQDAY    : ${payerGasBefore} -> ${payerGasAfter}   (unchanged = payer paid no gas)`);
console.log(`merchant tUSD8 : ${formatUnits(merchantBefore, 6)} -> ${formatUnits(merchantAfter, 6)}`);
console.log(`card remaining : ${formatUnits(await pay.remaining(cardId), 6)} tUSD8`);
console.log(`explorer       : ${EXPLORER}${rc.transactionHash}`);

console.log("\n== receipts (chunked getLogs, 1,000-block limit) ==");
const receipts = await pay.receipts({ fromBlock: DEPLOY_BLOCK, cardId });
for (const r of receipts.slice(-3)) {
  console.log(
    `  #${r.receiptIndex} ${r.transactionHash.slice(0, 12)}… units=${r.units} amount=${formatUnits(r.amount, 6)} tUSD8`,
  );
}

if (payerNonceBefore !== payerNonceAfter) {
  console.error("FAIL: payer broadcast a transaction during the charge");
  process.exitCode = 1;
}
