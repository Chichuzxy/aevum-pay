#!/usr/bin/env node
// Sponsored settlement: a session key pays for an API call, and a paymaster pays the gas —
// the account holds zero tQDAY the whole time.
//
//   node scripts/paymaster-demo.mjs
//
// Setup (once): node scripts/deploy-paymaster.mjs  → demo/paymaster/config.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbi,
  parseUnits,
  formatEther,
  formatUnits,
  keccak256,
  toHex,
  decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash, toPackedUserOperation } from "viem/account-abstraction";
import { createAevumPay, AEVUMPAY_ABI, ERC20_MIN_ABI, TUSD8 } from "../sdk/src/index.js";

const RPC = process.env.RPC_URL ?? "https://rpc-test.qday.info";
const OUT = new URL("../demo/paymaster/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const readEnv = (f) =>
  Object.fromEntries(
    readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const env = { ...readEnv(".env"), ...readEnv(".env.demo"), ...readEnv(".env.x402") };
const payer = privateKeyToAccount(key(env.PRIVATE_KEY));
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY)); // also the sponsorship signer
const merchant = privateKeyToAccount(key(env.MERCHANT_PRIVATE_KEY));

const pm = JSON.parse(readFileSync(new URL("./config.json", OUT), "utf8"));
const publicClient = createPublicClient({ transport: http(RPC) });
const wallet = (account) => createWalletClient({ account, transport: http(RPC) });
const keepAlive = setInterval(() => publicClient.getBlockNumber().catch(() => {}), 2000);
keepAlive.unref?.();

const pay = createAevumPay({ rpcUrl: RPC });
const gasPrice = await publicClient.getGasPrice();
const waitTx = (hash) => publicClient.waitForTransactionReceipt({ hash, pollingInterval: 400 });
const fmt = (v) => formatUnits(BigInt(v), 6);

const ACCOUNT_ABI = parseAbi([
  "constructor(address entryPoint, address owner)",
  "function execute(address dest, uint256 value, bytes data)",
  "function setSessionKey(address key, address target, bytes4 selector, uint64 validUntil)",
  "function sessionKey() view returns (address)",
]);
const PAYMASTER_ABI = parseAbi([
  "function validatePaymasterUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) returns (bytes,uint256)",
  "function getDeposit() view returns (uint256)",
  "function sponsoredOps() view returns (uint256)",
]);
const ENTRY = entryPoint07Address;

const send = async (account, to, abi, functionName, args, gas = 900_000n) => {
  const hash = await wallet(account).writeContract({ address: to, abi, functionName, args, chain: null, gasPrice, gas, type: "legacy" });
  return waitTx(hash);
};

console.log("payer    ", payer.address);
console.log("agent    ", agent.address, "(session key + sponsorship signer)");
console.log("paymaster", pm.paymaster, `deposit ${formatEther(await publicClient.readContract({ address: pm.paymaster, abi: PAYMASTER_ABI, functionName: "getDeposit" }))} tQDAY`);

// 1. merchant lists its price on v3 (the old listing lives on v2)
const resourceId = pay.resourceId("api.x402.infer");
const price = parseUnits("0.01", 6);
console.log("\n== merchant lists on v3 ==");
console.log("  listResource", (await send(merchant, pay.contract, AEVUMPAY_ABI, "registerMerchant", [], 200_000n)).status);
console.log("  listResource", (await send(merchant, pay.contract, AEVUMPAY_ABI, "listResource", [resourceId, price], 200_000n)).status);

// 2. deploy an account with NO native gas at all
const artifact = JSON.parse(readFileSync(new URL("../out/SessionKeyAccount.sol/SessionKeyAccount.json", import.meta.url), "utf8"));
const deployHash = await wallet(payer).deployContract({
  abi: ACCOUNT_ABI,
  bytecode: artifact.bytecode.object,
  args: [ENTRY, payer.address],
  chain: null,
  gasPrice,
  type: "legacy",
});
const account = (await waitTx(deployHash)).contractAddress;
console.log(`\naccount ${account} · tQDAY ${formatEther(await publicClient.getBalance({ address: account }))}`);

// 3. give it tUSD8 only, then pave the card (owner transactions pay their own gas, as usual)
const cap = parseUnits("0.03", 6);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const salt = BigInt(Date.now());
const execute = (dest, data) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [dest, 0n, data] });
await send(payer, TUSD8, ERC20_MIN_ABI, "transfer", [account, parseUnits("0.03", 6)], 120_000n);
await send(payer, account, ACCOUNT_ABI, "execute", [TUSD8, 0n, encodeFunctionData({ abi: ERC20_MIN_ABI, functionName: "approve", args: [pay.contract, cap] })]);
await send(payer, account, ACCOUNT_ABI, "execute", [pay.contract, 0n, encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "createCard", args: [account, merchant.address, cap, expiry, salt] })]);
const cardId = pay.cardId({ payer: account, spender: account, merchant: merchant.address, cap, expiry, salt });
const chargeSelector = encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: [cardId, resourceId, 1n, keccak256(toHex("x"))] }).slice(0, 10);
await send(payer, account, ACCOUNT_ABI, "setSessionKey", [agent.address, pay.contract, chargeSelector, BigInt(Math.floor(Date.now() / 1000) + 3600)], 200_000n);
console.log(`card ${cardId} · cap ${fmt(cap)} tUSD8 · session key ${agent.address}`);

// 4. build a userOp whose gas is paid by the paymaster
async function buildSponsoredOp(callData, { sponsored = true } = {}) {
  const nonce = await publicClient.readContract({ address: ENTRY, abi: entryPoint07Abi, functionName: "getNonce", args: [account, 0n] });
  const validUntil = Math.floor(Date.now() / 1000) + 3600;
  const validAfter = 0;
  const base = {
    sender: account,
    nonce,
    callData,
    callGasLimit: 400_000n,
    verificationGasLimit: 600_000n,
    preVerificationGas: 120_000n,
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: gasPrice,
    signature: "0x",
  };
  // 1) the sponsor signs a digest that excludes paymasterAndData (no circularity)
  const accountGasLimits = (base.verificationGasLimit << 128n) | base.callGasLimit;
  const gasFees = (base.maxPriorityFeePerGas << 128n) | base.maxFeePerGas;
  const hex32 = (v) => `0x${v.toString(16).padStart(64, "0")}`;
  const sponsorDigest = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint48" }, { type: "uint48" }],
      [account, nonce, keccak256(callData), hex32(accountGasLimits), hex32(gasFees), validUntil, validAfter],
    ),
  );
  const sponsorSig = sponsored ? await agent.sign({ hash: sponsorDigest }) : "0x" + "11".repeat(65);

  // 2) only now can the userOp be final: its hash includes the paymaster data, so the
  //    account's signature is computed over the completed operation
  const withPaymaster = {
    ...base,
    paymaster: pm.paymaster,
    paymasterVerificationGasLimit: 150_000n,
    paymasterPostOpGasLimit: 60_000n,
    paymasterData: encodeAbiParameters([{ type: "uint48" }, { type: "uint48" }, { type: "bytes" }], [validUntil, validAfter, sponsorSig]),
  };
  const userOpHash = getUserOperationHash({ userOperation: withPaymaster, entryPointAddress: ENTRY, entryPointVersion: "0.7", chainId: 44005 });
  return { ...withPaymaster, userOpHash, signature: await agent.sign({ hash: userOpHash }) };
}

async function relay(op, label) {
  const packed = toPackedUserOperation(op);
  const hash = await wallet(agent).writeContract({
    address: ENTRY,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[packed], agent.address],
    chain: null,
    gasPrice,
    gas: 2_500_000n,
    type: "legacy",
  });
  const rc = await waitTx(hash);
  console.log(`  ${label.padEnd(30)} status=${rc.status} gas=${rc.gasUsed} tx=${hash}`);
  if (rc.status !== "success") {
    try {
      await publicClient.simulateContract({
        address: ENTRY,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [[packed], agent.address],
        account: agent.address,
      });
    } catch (e) {
      const raw = e.data?.data ?? e.cause?.data?.data ?? e.cause?.data;
      let reason = e.shortMessage ?? "reverted";
      if (typeof raw === "string" && raw.startsWith("0x")) {
        try {
          const decoded = decodeErrorResult({ abi: entryPoint07Abi, data: raw });
          reason = `${decoded.errorName}(${(decoded.args ?? []).join(", ")})`;
        } catch {
          reason = `${reason} [${raw.slice(0, 74)}]`;
        }
      }
      console.log(`  reason: ${reason.slice(0, 200)}`);
      if (process.env.DEBUG_AA) {
        const rawObj = e.data?.data ?? e.cause?.data?.data ?? e.cause?.data ?? e.data;
        if (typeof rawObj === "string") {
          console.log("  debug raw:", rawObj.slice(0, 420));
        } else {
          console.log("  debug keys:", Object.keys(rawObj ?? {}).join(","));
          for (const [k, v] of Object.entries(rawObj ?? {})) {
            console.log(`  debug ${k}:`, String(v).slice(0, 300));
          }
        }
      }
    }
  }
  return { hash, rc };
}

const depositBefore = await publicClient.readContract({ address: pm.paymaster, abi: PAYMASTER_ABI, functionName: "getDeposit" });
const accountGasBefore = await publicClient.getBalance({ address: account });
const merchantBefore = await pay.balanceOf(merchant.address);

console.log("\n== sponsored userOp: session key pays 0.01 tUSD8, paymaster pays the gas ==");
const op1 = await buildSponsoredOp(execute(pay.contract, encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: [cardId, resourceId, 1n, keccak256(toHex("sponsored-1"))] })));
const r1 = await relay(op1, "handleOps(charge, sponsored)");

const depositAfter = await publicClient.readContract({ address: pm.paymaster, abi: PAYMASTER_ABI, functionName: "getDeposit" });
const accountGasAfter = await publicClient.getBalance({ address: account });
const merchantAfter = await pay.balanceOf(merchant.address);
console.log(`  account tQDAY   ${formatEther(accountGasBefore)} -> ${formatEther(accountGasAfter)}  (never had gas)`);
console.log(`  paymaster       ${formatEther(depositBefore)} -> ${formatEther(depositAfter)} tQDAY (paid the gas)`);
console.log(`  merchant tUSD8  ${fmt(merchantBefore)} -> ${fmt(merchantAfter)}`);
console.log(`  card remaining  ${fmt(await pay.remaining(cardId))}`);

console.log("\n== a userOp with a bogus sponsorship signature must be refused ==");
const op2 = await buildSponsoredOp(
  execute(pay.contract, encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: [cardId, resourceId, 1n, keccak256(toHex("sponsored-2"))] })),
  { sponsored: false },
);
const r2 = await relay(op2, "handleOps(forged sponsor sig)");
console.log(`  result: ${r2.rc.status === "success" ? "UNEXPECTED — accepted" : "refused by the paymaster"}`);

writeFileSync(
  new URL("./last-run.json", OUT),
  JSON.stringify(
    {
      account,
      cardId,
      paymaster: pm.paymaster,
      depositBefore: formatEther(depositBefore),
      depositAfter: formatEther(depositAfter),
      sponsoredTx: r1.hash,
      refusedTx: r2.hash,
      at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log("\nwritten to demo/paymaster/last-run.json");
