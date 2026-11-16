// AevumPay — static single-page UI (no build step).
// Reads and receipts come from the SDK; wallet writes go straight to the injected provider.
import { createWalletClient, custom, http, formatUnits, parseUnits, parseSignature, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createAevumPay,
  AEVUMPAY_ABI,
  ERC20_MIN_ABI,
  computeCardId,
  authorizationNonce,
  tokenDomain,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  TUSD8,
  RPC_URL,
  CHAIN_ID,
  EXPLORER,
} from "../sdk/src/index.js";

const DEPLOY_BLOCK = 3326369n; // AevumPay v2 deployment block
const DECIMALS = 6;

const CHAIN = {
  id: CHAIN_ID,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "QDay Explorer", url: EXPLORER.replace(/\/tx$/, "") } },
};

const pay = createAevumPay();
const $ = (id) => document.getElementById(id);
const short = (a, n = 6) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-4)}` : "");
const fmt = (v) => Number(formatUnits(BigInt(v ?? 0), DECIMALS)).toFixed(DECIMALS);
const fmtShort = (v) => {
  const s = fmt(v);
  return s.replace(/0+$/, "").replace(/\.$/, "") || "0";
};

const KNOWN_RESOURCES = { [createAevumPay().resourceId("api.infer.small")]: "api.infer.small" };
const resourceLabel = (id) => KNOWN_RESOURCES[id] ?? short(id, 6);
const shortTime = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const state = {
  address: null,
  wallet: null,
  cards: JSON.parse(localStorage.getItem("aevumpay.cards") ?? "[]"),
  activeCard: null,
  signed: null, // { auth, amount, cardId, resourceId, units }
};

// ── human-readable reverts ──────────────────────────────────────────────────
const REASONS = {
  "CapExceeded()": "This card doesn’t have enough budget left for that charge.",
  "CardRevokedErr()": "This card is revoked — open a new one to keep paying.",
  "CardExpired()": "This card has expired. Open a new one.",
  "SpenderMismatch()": "That agent key isn’t the spender on this card.",
  "MerchantMismatch()": "That resource belongs to a different merchant than this card.",
  "NotMerchant()": "That address isn’t registered as a merchant.",
  "ResourceNotActive()": "That resource isn’t listed any more.",
  "ZeroAmount()": "The amount can’t be zero.",
  "NotPayerOrSpender()": "Only the payer or the spender can change this card.",
  "TransferFailed()": "The token transfer failed — check the payer’s balance.",
};
const SELECTORS = Object.fromEntries(Object.keys(REASONS).map((sig) => [keccak256(toHex(sig)).slice(0, 10), sig]));

function explain(error) {
  const raw = `${error?.shortMessage ?? ""} ${error?.message ?? ""} ${error?.data?.data ?? ""} ${error?.cause?.data ?? ""}`;
  for (const [selector, sig] of Object.entries(SELECTORS)) {
    if (raw.toLowerCase().includes(selector)) {
      if (sig === "CapExceeded()" && state.activeCard) {
        return `${REASONS[sig]} Remaining: ${fmtShort(state.activeCard.remaining)} tUSD8.`;
      }
      return REASONS[sig];
    }
  }
  if (/user rejected|denied transaction/i.test(raw)) return "You rejected the request in your wallet.";
  if (/insufficient funds/i.test(raw)) return "Not enough tQDAY for gas — top up from the QDay faucet.";
  return error?.shortMessage ?? "Transaction failed. Try again.";
}

// ── toast / hints ───────────────────────────────────────────────────────────
let toastTimer;
function toast(message, kind = "") {
  const node = $("toast");
  node.textContent = message;
  node.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = "toast"), 4200);
}
const hint = (id, message, kind = "") => {
  const node = $(id);
  node.textContent = message;
  node.className = `hint ${kind}`;
};

// ── wallet ──────────────────────────────────────────────────────────────────
async function connect() {
  if (!window.ethereum) {
    toast("No browser wallet found. Install MetaMask or Rabby, then reload.", "bad");
    return;
  }
  try {
    const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
    state.address = address;
    state.wallet = createWalletClient({ account: address, chain: CHAIN, transport: custom(window.ethereum) });
    await ensureChain();
    const pill = $("net-pill");
    pill.textContent = `QDay Aevum · ${short(address, 4)}`;
    pill.className = "chip ok";
    $("connect-btn").textContent = "Connected";
    $("connect-btn").disabled = true;
    $("pay-sign").disabled = false;
    toast("Wallet connected", "ok");
    renderCards();
  } catch (error) {
    toast(explain(error), "bad");
  }
}

async function ensureChain() {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (Number.parseInt(current, 16) === CHAIN_ID) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${CHAIN_ID.toString(16)}`,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER.replace(/\/tx$/, "")],
        },
      ],
    });
  }
}

const write = (address, abi, functionName, args) =>
  state.wallet.writeContract({ address, abi, functionName, args, chain: CHAIN, account: state.address });

// If the x402 demo config is served next to /web/ (local preview), adopt its card,
// so the terminal demo and the browser are looking at the same card. On GitHub Pages
// this fetch 404s and is ignored.
async function adoptLocalDemoCard() {
  try {
    const res = await fetch("../demo/x402/config.json", { cache: "no-store" });
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg?.cardId) return;
    if (state.cards.some((c) => c.cardId.toLowerCase() === cfg.cardId.toLowerCase())) return;
    state.cards = [
      {
        cardId: cfg.cardId,
        resourceId: cfg.resourceId,
        resource: cfg.resource,
        merchant: cfg.merchant,
        createdAt: Date.now(),
        demo: true,
      },
      ...state.cards,
    ];
    localStorage.setItem("aevumpay.cards", JSON.stringify(state.cards));
    if ((location.hash.replace("#", "").split("/")[0] || "cards") === "cards") renderCards();
  } catch {
    /* no local demo config: fine */
  }
}

// ── view routing ────────────────────────────────────────────────────────────
const views = ["open", "cards", "pay", "merchant"];
function route() {
  const name = (location.hash.replace("#", "") || "cards").split("/")[0];
  const view = views.includes(name) ? name : "cards";
  views.forEach((v) => $(`view-${v}`).classList.toggle("active", v === view));
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "cards") renderCards();
  if (view === "pay") renderPaySelect();
  if (view === "merchant") loadMerchant();
}
window.addEventListener("hashchange", route);

// ── 1. open a card ──────────────────────────────────────────────────────────
let openQuote = null;

async function loadQuote() {
  const node = $("open-quote");
  try {
    const resourceId = pay.resourceId($("open-resource").value.trim() || "api.infer.small");
    const quote = await pay.quote(resourceId);
    openQuote = { resourceId, ...quote };
    node.innerHTML = quote.active
      ? `Price <b>${fmtShort(quote.unitPrice)} tUSD8</b> per unit · merchant <code>${short(quote.merchant)}</code>`
      : `This resource isn’t listed by any merchant yet. Ask the merchant to list it first.`;
  } catch (error) {
    openQuote = null;
    node.textContent = explain(error);
  }
}

async function openCard(event) {
  event.preventDefault();
  if (!state.wallet) return toast("Connect a wallet first.", "bad");
  const button = $("open-submit");
  try {
    if (!openQuote?.active) return toast("Load an active resource first.", "bad");
    const cap = parseUnits($("open-cap").value.trim(), DECIMALS);
    if (cap <= 0n) return toast("Cap must be greater than zero.", "bad");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number($("open-expiry").value));
    const salt = BigInt(Date.now());
    const spender = ($("open-spender").value.trim() || state.address);
    if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) return toast("Agent address looks wrong (0x + 40 hex).", "bad");

    button.disabled = true;
    button.textContent = "Waiting for wallet…";
    hint("open-hint", "1/2 approve the token…");

    const allowance = await pay.publicClient.readContract({
      address: TUSD8,
      abi: ERC20_MIN_ABI,
      functionName: "allowance",
      args: [state.address, pay.contract],
    });
    if (allowance < cap) {
      const hash = await write(TUSD8, ERC20_MIN_ABI, "approve", [pay.contract, cap]);
      await pay.publicClient.waitForTransactionReceipt({ hash });
    }

    hint("open-hint", "2/2 create the card…");
    const hash = await write(pay.contract, AEVUMPAY_ABI, "createCard", [
      spender,
      openQuote.merchant,
      cap,
      expiry,
      salt,
    ]);
    const receipt = await pay.publicClient.waitForTransactionReceipt({ hash });

    const cardId = computeCardId({
      payer: state.address,
      spender,
      merchant: openQuote.merchant,
      cap,
      expiry,
      salt,
    });
    state.cards = [
      { cardId, resourceId: openQuote.resourceId, resource: $("open-resource").value.trim(), merchant: openQuote.merchant, createdAt: Date.now() },
      ...state.cards.filter((c) => c.cardId !== cardId),
    ];
    localStorage.setItem("aevumpay.cards", JSON.stringify(state.cards));
    hint("open-hint", `Card opened: ${short(cardId, 8)}`, "ok");
    toast("Card opened — budget is live.", "ok");
    console.info("createCard", receipt.transactionHash);
    location.hash = "#cards";
  } catch (error) {
    hint("open-hint", explain(error), "bad");
    toast(explain(error), "bad");
  } finally {
    button.disabled = false;
    button.textContent = "Approve & open card";
  }
}

// ── 2. cards ────────────────────────────────────────────────────────────────
async function renderCards() {
  const list = $("card-list");
  const empty = $("cards-empty");
  const detail = $("card-detail");
  if (!state.cards.length) {
    empty.style.display = "";
    list.innerHTML = "";
    detail.innerHTML = "";
    return;
  }
  empty.style.display = "none";
  const rows = [];
  for (const entry of state.cards.slice(0, 12)) {
    let card = null;
    try {
      card = await pay.card(entry.cardId);
    } catch {
      continue;
    }
    const expired = Number(card.expiry) * 1000 < Date.now();
    const badge = card.revoked
      ? '<span class="badge revoked">revoked</span>'
      : expired
        ? '<span class="badge expired">expired</span>'
        : '<span class="badge ok">active</span>';
    rows.push(`
      <div class="card-row ${state.activeCard?.cardId === entry.cardId ? "selected" : ""}" data-card="${entry.cardId}">
        <div>
          <div class="mono">${short(entry.cardId, 10)}</div>
          <div class="muted">${entry.resource ?? "resource"}${entry.demo ? " · terminal demo card" : ""} · expires ${new Date(Number(card.expiry) * 1000).toLocaleString()}</div>
        </div>
        <div style="text-align:right">
          <div class="mono">${fmtShort(card.remaining)} / ${fmtShort(card.cap)} tUSD8</div>
          <div>${badge}</div>
        </div>
      </div>`);
  }
  list.innerHTML = rows.join("");
  list.querySelectorAll(".card-row").forEach((row) =>
    row.addEventListener("click", () => {
      state.activeCard = { ...state.activeCard, cardId: row.dataset.card, remaining: null };
      renderCards();
      selectCard(row.dataset.card);
    }),
  );
  if (state.activeCard?.cardId) selectCard(state.activeCard.cardId);
}

async function selectCard(cardId) {
  const detail = $("card-detail");
  const entry = state.cards.find((c) => c.cardId === cardId);
  detail.innerHTML = `<div class="card"><p class="fine">Loading card…</p></div>`;
  try {
    const card = await pay.card(cardId);
    state.activeCard = { ...entry, ...card, cardId };
    const spentPct = card.cap > 0n ? Number((card.spent * 10000n) / card.cap) / 100 : 0;
    const receipts = await pay.receipts({ fromBlock: DEPLOY_BLOCK, cardId });
    const times = await blockTimes(receipts.map((r) => r.blockNumber));
    const expired = Number(card.expiry) * 1000 < Date.now();

    detail.innerHTML = `
      <div class="card">
        <div class="table-head">
          <h2>Card ${short(cardId, 10)}</h2>
          ${
            card.revoked
              ? '<span class="badge revoked">revoked</span>'
              : expired
                ? '<span class="badge expired">expired</span>'
                : '<span class="badge ok">active</span>'
          }
        </div>

        <div class="detail-grid">
          <div class="metric"><span>Remaining</span><b>${fmtShort(card.remaining)}</b><small>tUSD8</small></div>
          <div class="metric"><span>Spent</span><b>${fmtShort(card.spent)}</b><small>tUSD8</small></div>
          <div class="metric"><span>Cap</span><b>${fmtShort(card.cap)}</b><small>tUSD8</small></div>
        </div>
        <div class="progress"><i style="width:${spentPct}%"></i></div>
        <p class="fine">${spentPct.toFixed(1)}% of the cap used · expires ${new Date(Number(card.expiry) * 1000).toLocaleString()} · merchant <code>${short(card.merchant)}</code></p>

        <div class="table-head" style="margin-top:18px">
          <h2>Receipts</h2>
          ${!card.revoked ? '<button class="btn btn-danger" id="revoke-btn">Revoke card</button>' : ""}
        </div>
        ${
          receipts.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Time</th><th class="num">Units</th><th class="num">Amount</th><th>Tx</th></tr></thead><tbody>
                ${receipts
                  .map(
                    (r) => `<tr><td>${r.receiptIndex}</td><td>${times[r.blockNumber] ? new Date(times[r.blockNumber]).toLocaleString() : `block ${r.blockNumber}`}</td><td class="num">${r.units}</td><td class="num">${fmtShort(r.amount)}</td><td><a href="${EXPLORER}/tx/${r.transactionHash}" target="_blank" rel="noreferrer">${short(r.transactionHash, 6)}</a></td></tr>`,
                  )
                  .join("")}
              </tbody></table></div>`
            : '<p class="fine">No charge on this card yet. Go to <a href="#pay">Pay</a> to settle one.</p>'
        }
      </div>`;

    const revoke = $("revoke-btn");
    if (revoke) revoke.addEventListener("click", () => revokeCard(cardId, card));
  } catch (error) {
    detail.innerHTML = `<div class="card"><p class="hint bad">${explain(error)}</p></div>`;
  }
}

// Charged carries no timestamp, so resolve block times for the receipts on screen.
async function blockTimes(blockNumbers) {
  const unique = [...new Set(blockNumbers.map(String))].slice(0, 40);
  const out = {};
  await Promise.all(
    unique.map(async (n) => {
      try {
        const block = await pay.publicClient.getBlock({ blockNumber: BigInt(n) });
        out[n] = Number(block.timestamp) * 1000;
      } catch {
        out[n] = 0;
      }
    }),
  );
  return out;
}

async function revokeCard(cardId) {
  if (!state.wallet) return toast("Connect the payer wallet first.", "bad");
  try {
    const hash = await write(pay.contract, AEVUMPAY_ABI, "revokeCard", [cardId]);
    await pay.publicClient.waitForTransactionReceipt({ hash });
    toast("Card revoked — the agent can’t charge it any more.", "ok");
    renderCards();
  } catch (error) {
    toast(explain(error), "bad");
  }
}

// ── 3. pay ──────────────────────────────────────────────────────────────────
function renderPaySelect() {
  const select = $("pay-card");
  if (!state.cards.length) {
    select.innerHTML = '<option value="">No card — open one first</option>';
    return;
  }
  select.innerHTML = state.cards
    .map((c) => `<option value="${c.cardId}">${short(c.cardId, 10)} · ${c.resource ?? "resource"}</option>`)
    .join("");
  updatePayPrice();
}

async function updatePayPrice() {
  const cardId = $("pay-card").value;
  const entry = state.cards.find((c) => c.cardId === cardId);
  const units = BigInt($("pay-units").value.trim() || "0");
  if (!entry) return ($("pay-price").textContent = "—");
  try {
    const quote = await pay.quote(entry.resourceId);
    $("pay-price").textContent = quote.active
      ? `${fmtShort(quote.unitPrice)} tUSD8 × ${units} = ${fmtShort(quote.unitPrice * units)} tUSD8`
      : "resource inactive";
  } catch {
    $("pay-price").textContent = "—";
  }
}

async function signCharge() {
  if (!state.wallet) return toast("Connect the payer wallet first.", "bad");
  const cardId = $("pay-card").value;
  const entry = state.cards.find((c) => c.cardId === cardId);
  if (!entry) return toast("Pick a card first.", "bad");
  try {
    const units = BigInt($("pay-units").value.trim() || "0");
    const quote = await pay.quote(entry.resourceId);
    const amount = quote.unitPrice * units;
    const salt = BigInt(Date.now());
    const spender = ($("open-spender").value.trim() || state.address);
    if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) return toast("Agent address looks wrong (0x + 40 hex).", "bad");
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = authorizationNonce({ payContract: pay.contract, cardId, amount, salt });

    $("pay-sig").className = "signature-box";
    $("pay-sig").textContent = "Waiting for your signature…";
    const signature = await state.wallet.signTypedData({
      account: state.address,
      domain: tokenDomain({ token: TUSD8 }),
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from: state.address, to: pay.contract, value: amount, validAfter: 0n, validBefore, nonce },
    });
    const { v, r, s } = parseSignature(signature);
    state.signed = {
      cardId,
      resourceId: entry.resourceId,
      units,
      amount,
      auth: { validAfter: 0n, validBefore, salt, v: Number(v), r, s },
    };
    $("pay-sig").className = "signature-box ok";
    $("pay-sig").textContent = `Signed for ${fmtShort(amount)} tUSD8 · nonce ${short(nonce, 10)} · no gas spent`;
    $("pay-submit").disabled = false;
    hint("pay-hint", "Payer signed. The agent can now submit — the payer needs no gas.", "ok");
  } catch (error) {
    state.signed = null;
    $("pay-sig").textContent = "Nothing signed yet.";
    hint("pay-hint", explain(error), "bad");
  }
}

async function submitCharge() {
  const key = $("pay-agent-key").value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return toast("Paste the agent’s private key (0x + 64 hex).", "bad");
  if (!state.signed) return toast("Ask the payer to sign first.", "bad");
  const button = $("pay-submit");
  try {
    button.disabled = true;
    button.textContent = "Submitting…";
    const account = privateKeyToAccount(key);
    const agentWallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
    const gasPrice = await pay.publicClient.getGasPrice();
    const hash = await agentWallet.writeContract({
      address: pay.contract,
      abi: AEVUMPAY_ABI,
      functionName: "chargeWithAuthorization",
      args: [
        state.signed.cardId,
        state.signed.resourceId,
        state.signed.units,
        keccak256(toHex(`receipt-${Date.now()}`)),
        state.signed.auth,
      ],
      chain: CHAIN,
      gasPrice,
      type: "legacy",
    });
    await pay.publicClient.waitForTransactionReceipt({ hash });
    hint("pay-hint", `Settled — the merchant was paid, the payer spent no gas.`, "ok");
    toast("Charge settled", "ok");
    $("pay-sig").innerHTML = `Settled in <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">${short(hash, 6)}</a>`;
    state.signed = null;
  } catch (error) {
    hint("pay-hint", explain(error), "bad");
    toast(explain(error), "bad");
  } finally {
    button.disabled = !state.signed;
    button.textContent = "2 · Submit charge";
  }
}

// ── 4. merchant ─────────────────────────────────────────────────────────────
let merchantRows = [];

async function loadMerchant() {
  const tbody = $("receipt-rows");
  tbody.innerHTML = '<tr><td colspan="6" class="empty">Loading receipts…</td></tr>';
  try {
    const rows = await pay.receipts({ fromBlock: DEPLOY_BLOCK });
    merchantRows = rows.reverse();
    const times = await blockTimes(rows.map((r) => r.blockNumber));
    const total = rows.reduce((sum, r) => sum + r.amount, 0n);
    const cards = new Set(rows.map((r) => r.cardId));
    const resources = new Set(rows.map((r) => r.resourceId));

    $("stat-count").textContent = rows.length;
    $("stat-total").textContent = `${fmtShort(total)}`;
    $("stat-cards").textContent = cards.size;
    $("stat-resources").textContent = resources.size;
    $("receipt-note").textContent = `${rows.length} Charged events read from block ${DEPLOY_BLOCK} in 1,000-block chunks (eth_getLogs limit on Aevum).`;

    tbody.innerHTML = rows.length
      ? rows
          .map(
            (r) => `<tr>
              <td>${r.receiptIndex}</td>
              <td class="col-time" title="block ${r.blockNumber}">${times[r.blockNumber] ? shortTime(times[r.blockNumber]) : `block ${r.blockNumber}`}</td>
              <td title="${r.resourceId}">${resourceLabel(r.resourceId)}</td>
              <td class="num">${r.units}</td>
              <td class="num">${fmtShort(r.amount)}</td>
              <td><a href="${EXPLORER}/tx/${r.transactionHash}" target="_blank" rel="noreferrer">${short(r.transactionHash, 6)}</a></td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty">No receipts yet — settle a charge from the Pay tab.</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${explain(error)}</td></tr>`;
  }
}

function exportCsv() {
  if (!merchantRows.length) return toast("Nothing to export yet.", "bad");
  const header = "receiptIndex,blockNumber,cardId,resourceId,payer,merchant,units,amount,receiptHash,txHash";
  const body = merchantRows
    .map((r) => [r.receiptIndex, r.blockNumber, r.cardId, r.resourceId, r.payer, r.merchant, r.units, fmt(r.amount), r.receiptHash, r.transactionHash].join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([`${header}\n${body}`], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "aevumpay-receipts.csv" });
  link.click();
  URL.revokeObjectURL(url);
  toast("CSV exported", "ok");
}

// ── wiring ──────────────────────────────────────────────────────────────────
$("connect-btn").addEventListener("click", connect);
$("open-form").addEventListener("submit", openCard);
$("open-resource").addEventListener("change", loadQuote);
$("open-resource").addEventListener("blur", loadQuote);
$("pay-sign").addEventListener("click", signCharge);
$("pay-submit").addEventListener("click", submitCharge);
$("pay-card").addEventListener("change", updatePayPrice);
$("pay-units").addEventListener("input", updatePayPrice);
$("refresh-btn").addEventListener("click", loadMerchant);
$("csv-btn").addEventListener("click", exportCsv);
$("side-contract").textContent = short(pay.contract, 8);
$("side-contract").href = `${EXPLORER}/address/${pay.contract}`;
$("side-token").textContent = short(TUSD8, 8);
$("side-token").href = `${EXPLORER}/address/${TUSD8}`;
$("pay-sign").disabled = true;

if (window.ethereum?.request) {
  window.ethereum.request({ method: "eth_accounts" }).then((accts) => {
    if (accts?.length) connect();
  });
}

route();
loadQuote();
adoptLocalDemoCard();
