#!/usr/bin/env node
// One-time setup for the x402 demo: three clean roles on QDay Aevum testnet.
//   payer    = your funded wallet (.env PRIVATE_KEY)
//   agent    = throwaway client agent (.env.demo AGENT_PRIVATE_KEY)      -> spender
//   merchant = throwaway API vendor key (.env.x402 MERCHANT_PRIVATE_KEY) -> receives tUSD8
// Writes demo/x402/config.json (public data only; keys stay in .env files).
import { readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, http, keccak256, toHex, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAevumPay, AEVUMPAY_ABI, ERC20_MIN_ABI, TUSD8 } from "../../sdk/src/index.js";

const RESOURCE = process.env.X402_RESOURCE ?? "api.x402.infer";
const PRICE = parseUnits(process.env.X402_PRICE ?? "0.01", 6); // tUSD8 per call
const CAP = parseUnits(process.env.X402_CAP ?? "0.05", 6);
const CONFIG = new URL("./config.json", import.meta.url);

const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);

const env = { ...readEnv(".env"), ...readEnv(".env.demo"), ...readEnv(".env.x402") };
if (!env.MERCHANT_PRIVATE_KEY) throw new Error("MERCHANT_PRIVATE_KEY missing: create .env.x402 first");

const payer = privateKeyToAccount(key(env.PRIVATE_KEY));
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY));
const merchant = privateKeyToAccount(key(env.MERCHANT_PRIVATE_KEY));
const pay = createAevumPay({ rpcUrl: env.RPC_URL, contract: env.AEVUMPAY_ADDRESS, token: env.TUSD8_ADDRESS });
const gasPrice = await pay.publicClient.getGasPrice();
const wallet = (account) => createWalletClient({ account, transport: http(env.RPC_URL) });

const send = async (account, address, abi, functionName, args) => {
  const hash = await wallet(account).writeContract({ address, abi, functionName, args, chain: null, gasPrice, type: "legacy" });
  const receipt = await pay.publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${functionName.padEnd(16)} status=${receipt.status} tx=${hash}`);
  return receipt;
};

const resourceId = keccak256(toHex(RESOURCE));
const salt = BigInt(Date.now());
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);

console.log("payer   ", payer.address);
console.log("agent   ", agent.address, "(spender)");
console.log("merchant", merchant.address, "(receives tUSD8)\n");

// 1) merchant lists its price on-chain (needs a little tQDAY for the two setup txs)
const registered = await pay.publicClient.readContract({
  address: pay.contract,
  abi: AEVUMPAY_ABI,
  functionName: "merchants",
  args: [merchant.address],
});
if (!registered) {
  if ((await pay.publicClient.getBalance({ address: merchant.address })) < 10n ** 16n) {
    const hash = await wallet(payer).sendTransaction({ to: merchant.address, value: 10n ** 16n, chain: null, gasPrice, type: "legacy" });
    await pay.publicClient.waitForTransactionReceipt({ hash });
    console.log("  funded merchant     0.01 tQDAY for setup");
  }
  await send(merchant, pay.contract, AEVUMPAY_ABI, "registerMerchant", []);
  await send(merchant, pay.contract, AEVUMPAY_ABI, "listResource", [resourceId, PRICE]);
} else {
  const quote = await pay.quote(resourceId);
  if (quote.merchant.toLowerCase() !== merchant.address.toLowerCase() || quote.unitPrice !== PRICE) {
    await send(merchant, pay.contract, AEVUMPAY_ABI, "listResource", [resourceId, PRICE]);
  }
}

// 2) payer approves the cap once, then opens a metered card for this merchant
const allowance = await pay.publicClient.readContract({
  address: TUSD8,
  abi: ERC20_MIN_ABI,
  functionName: "allowance",
  args: [payer.address, pay.contract],
});
if (allowance < CAP) await send(payer, TUSD8, ERC20_MIN_ABI, "approve", [pay.contract, CAP]);
await send(payer, pay.contract, AEVUMPAY_ABI, "createCard", [agent.address, merchant.address, CAP, expiry, salt]);

const cardId = pay.cardId({ payer: payer.address, spender: agent.address, merchant: merchant.address, cap: CAP, expiry, salt });

writeFileSync(
  CONFIG,
  JSON.stringify(
    {
      chainId: 44005,
      rpcUrl: env.RPC_URL,
      payContract: pay.contract,
      token: pay.token,
      payer: payer.address,
      agent: agent.address,
      merchant: merchant.address,
      cardId,
      resource: RESOURCE,
      resourceId,
      price: PRICE.toString(),
      priceHuman: formatUnits(PRICE, 6),
      cap: CAP.toString(),
      expiry: expiry.toString(),
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log("\ncardId  ", cardId);
console.log("config   demo/x402/config.json");
console.log("\nnext:  node demo/x402/merchant.mjs   # terminal 1");
console.log("       node demo/x402/agent.mjs      # terminal 2");
