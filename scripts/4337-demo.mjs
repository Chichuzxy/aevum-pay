#!/usr/bin/env node
// ERC-4337 session key demo on QDay Aevum testnet (EntryPoint v0.7).
//
//   payer -> owns a SessionKeyAccount and funds it
//   agent -> holds a session key that can ONLY call AevumPay.charge, and relays the userOp
//
// Run: node scripts/4337-demo.mjs   (after `forge build`, which produces out/SessionKeyAccount.sol)
// Proves: (1) a userOp settles a metered charge from the smart account,
//         (2) the same session key cannot move funds anywhere else.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  parseUnits,
  formatUnits,
  keccak256,
  toHex,
  decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash, toPackedUserOperation } from "viem/account-abstraction";
import { createAevumPay, AEVUMPAY_ABI, ERC20_MIN_ABI, TUSD8 } from "../sdk/src/index.js";

const RPC = process.env.RPC_URL ?? "https://rpc-test.qday.info";
const OUT = new URL("../demo/4337/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const env = { ...readEnv(".env"), ...readEnv(".env.demo") };
const payer = privateKeyToAccount(key(env.PRIVATE_KEY));
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY));

const publicClient = createPublicClient({ transport: http(RPC) });
const wallet = (account) => createWalletClient({ account, transport: http(RPC) });
const keepAlive = setInterval(() => publicClient.getBlockNumber().catch(() => {}), 2000);
keepAlive.unref?.();

const pay = createAevumPay({ rpcUrl: RPC });
const gasPrice = await publicClient.getGasPrice();
const waitTx = (hash) => publicClient.waitForTransactionReceipt({ hash, pollingInterval: 400 });
const fmt = (v) => formatUnits(BigInt(v), 6);

const send = async (account, to, abi, functionName, args, gas = 900_000n) => {
  const hash = await wallet(account).writeContract({ address: to, abi, functionName, args, chain: null, gasPrice, gas, type: "legacy" });
  const rc = await waitTx(hash);
  console.log(`  ${functionName.padEnd(14)} status=${rc.status} gas=${rc.gasUsed} tx=${hash}`);
  return rc;
};

const ACCOUNT_ABI = parseAbi([
  "constructor(address entryPoint, address owner)",
  "function execute(address dest, uint256 value, bytes data)",
  "function setSessionKey(address key, address target, bytes4 selector, uint64 validUntil)",
  "function sessionKey() view returns (address)",
  "function owner() view returns (address)",
]);
const TOKEN_ABI = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const ENTRY = entryPoint07Address;
const chargeCalldata = encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: ["0x" + "00".repeat(32), "0x" + "00".repeat(32), 1n, "0x" + "00".repeat(32)] });
const CHARGE_SELECTOR = chargeCalldata.slice(0, 10);

console.log("payer     ", payer.address);
console.log("agent     ", agent.address);
const entryCode = await publicClient.getBytecode({ address: ENTRY });
console.log("entryPoint", ENTRY, `(v0.7, ${entryCode ? (entryCode.length - 2) / 2 : 0} bytes of code)`);

// 1. deploy the account (owner = payer)
const artifact = JSON.parse(readFileSync(new URL("../out/SessionKeyAccount.sol/SessionKeyAccount.json", import.meta.url), "utf8"));
const deployHash = await wallet(payer).deployContract({
  abi: ACCOUNT_ABI,
  bytecode: artifact.bytecode.object,
  args: [ENTRY, payer.address],
  chain: null,
  gasPrice,
  type: "legacy",
});
const deployRc = await waitTx(deployHash);
const account = deployRc.contractAddress;
console.log(`\ndeploy account ${account} status=${deployRc.status} gas=${deployRc.gasUsed}`);

// 2. fund the account: tUSD8 to spend + tQDAY for the EntryPoint prefund
await send(payer, TUSD8, ERC20_MIN_ABI, "transfer", [account, parseUnits("0.05", 6)], 120_000n);
const fundHash = await wallet(payer).sendTransaction({ to: account, value: parseUnits("0.03", 18), chain: null, gasPrice, type: "legacy" });
await waitTx(fundHash);
console.log(`  funded        tUSD8 ${fmt(await pay.balanceOf(account))} · tQDAY ${formatUnits(await publicClient.getBalance({ address: account }), 18)}`);

// 3. owner prepares the card (account is payer and spender)
const x402 = JSON.parse(readFileSync(new URL("../demo/x402/config.json", import.meta.url), "utf8"));
const resourceId = pay.resourceId("api.x402.infer");
const cap = parseUnits("0.05", 6);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const salt = BigInt(Date.now());
const execute = (dest, data) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [dest, 0n, data] });

await send(payer, account, ACCOUNT_ABI, "execute", [
  TUSD8,
  0n,
  encodeFunctionData({ abi: ERC20_MIN_ABI, functionName: "approve", args: [pay.contract, cap] }),
]);
await send(payer, account, ACCOUNT_ABI, "execute", [
  pay.contract,
  0n,
  encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "createCard", args: [account, x402.merchant, cap, expiry, salt] }),
]);
const cardId = pay.cardId({ payer: account, spender: account, merchant: x402.merchant, cap, expiry, salt });
console.log(`  card ${cardId} · cap ${fmt(cap)} tUSD8 · payer=spender=account`);

// 4. owner grants a scoped session key: only charge() on AevumPay, one hour
const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600);
await send(payer, account, ACCOUNT_ABI, "setSessionKey", [agent.address, pay.contract, CHARGE_SELECTOR, validUntil], 200_000n);
console.log(`  session key ${await publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "sessionKey" })} → only charge() ${CHARGE_SELECTOR}`);

// 5. agent signs a userOp (as the session key) and relays it as the bundler
async function buildUserOp(callData) {
  const nonce = await publicClient.readContract({ address: ENTRY, abi: entryPoint07Abi, functionName: "getNonce", args: [account, 0n] });
  const userOperation = {
    sender: account,
    nonce,
    callData,
    callGasLimit: 400_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 120_000n,
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: gasPrice,
    signature: "0x",
  };
  const userOpHash = getUserOperationHash({ userOperation, entryPointAddress: ENTRY, entryPointVersion: "0.7", chainId: 44005 });
  const signature = await agent.sign({ hash: userOpHash });
  return { ...userOperation, signature, userOpHash };
}

async function relay(userOp, label) {
  const packed = toPackedUserOperation(userOp);
  const hash = await wallet(agent).writeContract({
    address: ENTRY,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[packed], agent.address],
    chain: null,
    gasPrice,
    gas: 2_000_000n,
    type: "legacy",
  });
  const rc = await waitTx(hash);
  console.log(`  ${label.padEnd(26)} status=${rc.status} gas=${rc.gasUsed} tx=${hash}`);
  if (rc.status !== "success") {
    let reason = "reverted";
    try {
      await publicClient.simulateContract({
        address: ENTRY,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [[packed], agent.address],
        account: agent.address,
      });
    } catch (simulation) {
      const raw = simulation.data?.data ?? simulation.cause?.data?.data ?? simulation.cause?.data ?? simulation.data;
      if (typeof raw === "string" && raw.startsWith("0x")) {
        try {
          const decoded = decodeErrorResult({ abi: entryPoint07Abi, data: raw });
          reason = `${decoded.errorName}(${(decoded.args ?? []).join(", ")})`;
        } catch {
          reason = `${simulation.shortMessage} [${raw.slice(0, 74)}]`;
        }
      } else {
        reason = `${simulation.shortMessage} ${simulation.details ?? ""}`.slice(0, 200);
      }
    }
    console.log(`  reason: ${reason.slice(0, 220)}`);
  }
  return { hash, rc };
}

console.log("\n== userOp 1: pay one API call through the session key ==");
const merchantBefore = await pay.balanceOf(x402.merchant);
const op1 = await buildUserOp(
  execute(pay.contract, encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: [cardId, resourceId, 1n, keccak256(toHex(`4337:${Date.now()}`))] })),
);
const r1 = await relay(op1, "handleOps(charge)");
const merchantAfter = await pay.balanceOf(x402.merchant);
console.log(`  merchant tUSD8 ${fmt(merchantBefore)} -> ${fmt(merchantAfter)} · card remaining ${fmt(await pay.remaining(cardId))}`);
console.log(`  the payer's key did not send this transaction — the agent relayed it.`);

console.log("\n== userOp 2: the same session key tries to move funds out ==");
const op2 = await buildUserOp(
  execute(TUSD8, encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [agent.address, parseUnits("0.01", 6)] })),
);
const r2 = await relay(op2, "handleOps(token.transfer)");
console.log(`  result: ${r2.rc.status === "success" ? "UNEXPECTED — transfer allowed" : "rejected during validation: it can only charge"}`);

writeFileSync(
  new URL("./config.json", OUT),
  JSON.stringify({ account, cardId, merchant: x402.merchant, entryPoint: ENTRY, sessionKey: agent.address, userOp1: r1.hash, userOp2: r2.hash, createdAt: new Date().toISOString() }, null, 2) + "\n",
);
console.log(`\nconfig written to demo/4337/config.json`);
