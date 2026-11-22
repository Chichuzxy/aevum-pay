#!/usr/bin/env node
// A real HTTP API that costs tUSD8 per call — the merchant side of the x402 loop.
//
//   GET /infer?q=...             no payment  -> 402 + a quote the agent can pay
//                                X-PAYMENT    -> verified on-chain, then 200 + result
//   GET /stats                   what this merchant has settled
//
// The inference itself is a deterministic stub (hash -> tokens). The payment rail is real.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createPublicClient, http, decodeEventLog, formatUnits } from "viem";
import { AEVUMPAY_ABI } from "../../sdk/src/index.js";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const PORT = Number(process.env.PORT ?? 8402);
const client = createPublicClient({ transport: http(config.rpcUrl) });
// QDay's RPC drops idle TLS after ~5s; ping so verification latency measures the chain.
const keepAlive = setInterval(() => client.getBlockNumber().catch(() => {}), 2000);
keepAlive.unref?.();

const used = new Set(); // tx hashes already spent (one receipt pays one call)
const stats = { calls: 0, revenue: 0n, lastTx: null, rejected: 0 };

const challenge = () => ({
  error: "payment_required",
  scheme: "aevumpay-metered",
  network: `qday-aevum-${config.chainId}`,
  resource: config.resource,
  price: config.price,
  priceHuman: config.priceHuman,
  token: config.token,
  decimals: 6,
  payContract: config.payContract,
  merchant: config.merchant,
  cardId: config.cardId,
  units: 1,
  howToPay: {
    step: "call AevumPay.charge(cardId, resourceId, 1, receiptHash) from the card's spender",
    then: "retry this URL with header X-PAYMENT: <tx hash>",
  },
});

/** A Charged event in this tx, for this merchant + resource + price? */
async function verifyPayment(txHash, prompt) {
  if (used.has(txHash)) return { ok: false, reason: "receipt_already_spent" };
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return { ok: false, reason: "tx_not_found" };
  if (receipt.status !== "success") return { ok: false, reason: "tx_reverted" };

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.payContract.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: AEVUMPAY_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Charged") continue;
      const { cardId, resourceId, merchant, amount, receiptHash, receiptIndex } = decoded.args;
      if (cardId.toLowerCase() !== config.cardId.toLowerCase()) return { ok: false, reason: "wrong_card" };
      if (resourceId.toLowerCase() !== config.resourceId.toLowerCase()) return { ok: false, reason: "wrong_resource" };
      if (merchant.toLowerCase() !== config.merchant.toLowerCase()) return { ok: false, reason: "wrong_merchant" };
      if (amount < BigInt(config.price)) return { ok: false, reason: "underpaid" };
      used.add(txHash);
      stats.calls += 1;
      stats.revenue += amount;
      stats.lastTx = txHash;
      return { ok: true, amount, receiptHash, receiptIndex, blockNumber: receipt.blockNumber, prompt };
    } catch {
      /* not our event */
    }
  }
  return { ok: false, reason: "no_matching_charge" };
}

/**
 * Real inference through a local Ollama server, with an honest fallback.
 * If Ollama is not running (or the model is missing), the response says so and returns the
 * deterministic stub — the payment rail never pretends to be a model.
 */
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:0.5b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);

function stubInference(prompt) {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((word, i) => `${word.slice(0, 6)}-${((i + 1) * 7) % 97}`);
  return { model: "aevum-stub-1", source: "stub", text: tokens.join(", "), tokens };
}

async function infer(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: `Answer in at most two sentences.\n\n${prompt}`,
        stream: false,
        options: { num_predict: 90, temperature: 0.4 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const data = await res.json();
    return {
      model: OLLAMA_MODEL,
      source: "ollama",
      text: (data.response ?? "").trim(),
      evalCount: data.eval_count ?? null,
      evalMs: data.eval_duration ? Math.round(Number(data.eval_duration) / 1e6) : null,
    };
  } catch (error) {
    console.warn(`inference fell back to stub: ${error.message}`);
    return { ...stubInference(prompt), note: "Ollama was unreachable, so this answer is the deterministic stub" };
  } finally {
    clearTimeout(timer);
  }
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/stats") {
    return json(res, 200, {
      resource: config.resource,
      calls: stats.calls,
      revenue: formatUnits(stats.revenue, 6),
      revenueBaseUnits: stats.revenue.toString(),
      rejected: stats.rejected,
      lastTx: stats.lastTx,
      cardId: config.cardId,
      merchant: config.merchant,
    });
  }

  if (url.pathname !== "/infer") return json(res, 404, { error: "not_found" });

  const prompt = url.searchParams.get("q") ?? "hello agent";
  const payment = req.headers["x-payment"];

  if (!payment) {
    res.setHeader("www-authenticate", `AevumPay realm="${config.resource}"`);
    return json(res, 402, challenge());
  }

  try {
    const verdict = await verifyPayment(String(payment), prompt);
    if (!verdict.ok) {
      stats.rejected += 1;
      return json(res, 402, { error: "payment_invalid", reason: verdict.reason, retry: challenge() });
    }
    return json(res, 200, {
      result: await infer(prompt),
      payment: {
        tx: String(payment),
        amount: formatUnits(verdict.amount, 6),
        amountBaseUnits: verdict.amount.toString(),
        receiptIndex: String(verdict.receiptIndex),
        blockNumber: String(verdict.blockNumber),
        cardId: config.cardId,
      },
      served: stats.calls,
    });
  } catch (error) {
    return json(res, 500, { error: "verification_failed", message: error.shortMessage ?? String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`x402 merchant listening on http://127.0.0.1:${PORT}`);
  console.log(`  resource  ${config.resource}  @ ${config.priceHuman} tUSD8 / call`);
  console.log(`  merchant  ${config.merchant}`);
  console.log(`  card      ${config.cardId}`);
});
