#!/usr/bin/env node
// The buyer side: an agent that hits a 402, pays from its session card, and retries.
//
//   node demo/x402/agent.mjs                 # pay until the card is empty, then prove the cap blocks
//   node demo/x402/agent.mjs --calls 2       # cap the number of paid calls
//
// Notes on the timing numbers printed below:
//   - "chain" is derived from the block timestamp minus send time (real inclusion latency).
//   - "wall" includes this machine's RPC connection. QDay's RPC drops idle TLS after ~5s,
//     so both demo processes run a 2s keep-alive ping; without it every call re-pays a
//     ~5s handshake (measured, not guessed).
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createWalletClient, http, keccak256, toHex, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAevumPay, AEVUMPAY_ABI } from "../../sdk/src/index.js";

const maxCalls = Number(process.argv.includes("--calls") ? process.argv[process.argv.indexOf("--calls") + 1] : 10);
const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const base = process.env.X402_URL ?? "http://127.0.0.1:8402";
const evidenceDir = new URL("../../evidence/", import.meta.url);
mkdirSync(evidenceDir, { recursive: true });
const evidenceFile = new URL(`x402-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`, evidenceDir);

const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const env = { ...readEnv(".env"), ...readEnv(".env.demo") };
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY));
const pay = createAevumPay({ rpcUrl: config.rpcUrl, contract: config.payContract, token: config.token });
const wallet = createWalletClient({ account: agent, transport: http(config.rpcUrl) });

// Keep the TLS session warm so the wall clock measures the chain, not the handshake.
const keepAlive = setInterval(() => pay.publicClient.getBlockNumber().catch(() => {}), 2000);
keepAlive.unref?.();

const gasPrice = await pay.publicClient.getGasPrice();
const GAS = 220_000n;
const record = (entry) => appendFileSync(evidenceFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const price = BigInt(config.price);

async function paidCall(prompt) {
  const started = Date.now();

  // 1. ask first; the merchant answers 402 with a quote
  const challengeRes = await fetch(`${base}/infer?q=${encodeURIComponent(prompt)}`);
  const challenge = await challengeRes.json();
  if (challengeRes.status !== 402) throw new Error(`expected 402, got ${challengeRes.status}`);
  const quotedAt = Date.now();
  console.log(`  402  ${challenge.priceHuman} tUSD8/unit · ${quotedAt - started}ms`);

  // 2. settle on-chain from the session card (cap + expiry enforced by the contract)
  const sentAt = Date.now();
  const tx = await wallet.writeContract({
    address: config.payContract,
    abi: AEVUMPAY_ABI,
    functionName: "charge",
    args: [config.cardId, config.resourceId, 1n, keccak256(toHex(`x402:${prompt}:${sentAt}`))],
    chain: null,
    gasPrice,
    gas: GAS,
    type: "legacy",
  });
  const rc = await pay.publicClient.waitForTransactionReceipt({ hash: tx, pollingInterval: 400 });
  const minedAt = Date.now();
  if (rc.status !== "success") {
    const failure = new Error(`charge reverted on-chain: ${tx}`);
    failure.txHash = tx;
    failure.blockNumber = rc.blockNumber;
    throw failure;
  }

  // Chain-derived timing: the interval between this block and the previous one.
  // (Wall-clock includes this machine's VPN/RPC handshake, which is not a chain property.)
  const block = await pay.publicClient.getBlock({ blockNumber: rc.blockNumber });
  const prev = await pay.publicClient.getBlock({ blockNumber: rc.blockNumber - 1n });
  const blockMs = (Number(block.timestamp) - Number(prev.timestamp)) * 1000;
  console.log(`  paid tx ${short(tx)} gas ${rc.gasUsed} · block ${rc.blockNumber} (+${blockMs}ms) · wall ${minedAt - sentAt}ms`);

  // 3. retry with the receipt; the merchant verifies the Charged event on-chain
  const verifyAt = Date.now();
  const paidRes = await fetch(`${base}/infer?q=${encodeURIComponent(prompt)}`, { headers: { "X-PAYMENT": tx } });
  const body = await paidRes.json();
  const doneAt = Date.now();
  if (paidRes.status !== 200) throw new Error(`payment not accepted: ${JSON.stringify(body)}`);

  const row = {
    prompt,
    status: paidRes.status,
    amount: body.payment.amount,
    tx,
    gasUsed: String(rc.gasUsed),
    gasPriceWei: String(gasPrice),
    gasCostTQDAY: (Number(rc.gasUsed) * Number(gasPrice)) / 1e18,
    block: String(rc.blockNumber),
    receiptIndex: body.payment.receiptIndex,
    ms: { challenge: quotedAt - started, settleWall: minedAt - sentAt, blockMs, verify: doneAt - verifyAt, total: doneAt - started },
    result: body.result.tokens.slice(0, 3).map((t) => t.token),
  };
  record({ kind: "paid_call", ...row });
  console.log(`  200  receipt #${row.receiptIndex} · verify ${row.ms.verify}ms · total ${row.ms.total}ms`);
  console.log(`       ${row.result.join(", ")}`);
  return row;
}

console.log(`agent ${agent.address}`);
console.log(`card  ${config.cardId}`);
console.log(`start remaining ${formatUnits(await pay.remaining(config.cardId), 6)} tUSD8\n`);

const results = [];
for (let i = 1; i <= maxCalls; i += 1) {
  const remaining = await pay.remaining(config.cardId);
  if (remaining < price) {
    console.log(`budget exhausted: ${formatUnits(remaining, 6)} tUSD8 left (< ${config.priceHuman})`);
    break;
  }
  console.log(`call ${i} · remaining ${formatUnits(remaining, 6)} tUSD8`);
  try {
    results.push(await paidCall(`summarise quantum error correction part ${i}`));
  } catch (error) {
    console.log(`  stopped: ${error.shortMessage ?? error.message}`);
    record({ kind: "call_failed", call: i, message: (error.shortMessage ?? error.message).slice(0, 200) });
    break;
  }
  console.log("");
}

// The card is empty now: the agent tries anyway. The contract must refuse, on-chain.
console.log("over-budget attempt — the chain must refuse, so the merchant never sells for free");
try {
  await paidCall("one call past the budget");
  console.log("  UNEXPECTED: the charge went through past the cap");
  record({ kind: "over_cap", unexpected: true });
} catch (error) {
  // The receipt only says "reverted"; replay it as a call to recover the revert reason.
  let reason = error.shortMessage ?? error.message;
  try {
    await pay.publicClient.simulateContract({
      address: config.payContract,
      abi: AEVUMPAY_ABI,
      functionName: "charge",
      args: [config.cardId, config.resourceId, 1n, keccak256(toHex("over-budget probe"))],
      account: agent.address,
    });
  } catch (simulation) {
    reason = simulation.shortMessage ?? `${simulation.message}`;
  }
  const capHit = /CapExceeded|0xa4875a49/i.test(reason);
  console.log(`  refused on-chain: ${capHit ? "CapExceeded" : reason.slice(0, 120)}`);
  if (error.txHash) console.log(`  reverted tx ${error.txHash} (status 0)`);
  record({ kind: "over_cap", expectedRejection: true, capHit, tx: error.txHash ?? null, message: reason.slice(0, 200) });
}

const forged = await fetch(`${base}/infer?q=no%20payment`, { headers: { "X-PAYMENT": "0x" + "11".repeat(32) } });
console.log(`forged receipt       -> HTTP ${forged.status} ${(await forged.json()).reason ?? ""}`);
record({ kind: "forged_receipt", status: forged.status });

const stats = await (await fetch(`${base}/stats`)).json();
const totalGas = results.reduce((sum, r) => sum + r.gasCostTQDAY, 0);
const avg = (pick) => Math.round(results.reduce((sum, r) => sum + pick(r), 0) / (results.length || 1));
console.log("\n== summary ==");
console.log(`paid calls        ${results.length}`);
console.log(`merchant revenue  ${stats.revenue} tUSD8 from ${stats.calls} settled calls`);
console.log(`gas per call      ${results[0]?.gasUsed ?? "-"} gas = ${(results[0]?.gasCostTQDAY ?? 0).toExponential(2)} tQDAY`);
console.log(`block interval    ${avg((r) => r.ms.blockMs)}ms avg (chain data)`);
console.log(`round trip        ${avg((r) => r.ms.total)}ms avg (includes verify)`);
console.log(`evidence          ${evidenceFile.pathname.replace(/^\//, "")}`);
