#!/usr/bin/env node
// Deploy the gas-sponsoring paymaster and pre-fund it at the EntryPoint.
//   node scripts/deploy-paymaster.mjs
// Owner = the payer wallet, sponsor signer = the agent key (the "sponsorship service" in the demo).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import { createAevumPay } from "../sdk/src/index.js";

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
const env = { ...readEnv(".env"), ...readEnv(".env.demo") };
const payer = privateKeyToAccount(key(env.PRIVATE_KEY));
const agent = privateKeyToAccount(key(env.AGENT_PRIVATE_KEY));

const publicClient = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account: payer, transport: http(RPC) });
const pay = createAevumPay({ rpcUrl: RPC });
const gasPrice = await publicClient.getGasPrice();

const artifact = JSON.parse(readFileSync(new URL("../out/VerifyingPaymaster.sol/VerifyingPaymaster.json", import.meta.url), "utf8"));
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [entryPoint07Address, agent.address, payer.address],
  chain: null,
  gasPrice,
  type: "legacy",
});
const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 400 });
const paymaster = rc.contractAddress;
console.log(`paymaster ${paymaster} status=${rc.status} gas=${rc.gasUsed} tx=${hash}`);
console.log(`signer    ${agent.address} (sponsorship service)`);
console.log(`owner     ${payer.address}`);

// fund the EntryPoint deposit so it can actually pay for sponsored userOps
const deposit = parseEther(process.env.PAYMASTER_DEPOSIT ?? "0.02");
const depositHash = await wallet.writeContract({
  address: paymaster,
  abi: artifact.abi,
  functionName: "deposit",
  args: [],
  value: deposit,
  chain: null,
  gasPrice,
  type: "legacy",
});
await publicClient.waitForTransactionReceipt({ hash: depositHash, pollingInterval: 400 });
const balance = await publicClient.readContract({ address: paymaster, abi: artifact.abi, functionName: "getDeposit" });
console.log(`deposit   ${formatEther(balance)} tQDAY at EntryPoint (tx ${depositHash})`);

writeFileSync(
  new URL("./config.json", OUT),
  JSON.stringify(
    {
      paymaster,
      entryPoint: entryPoint07Address,
      signer: agent.address,
      owner: payer.address,
      aevumPay: pay.contract,
      depositTQDAY: formatEther(balance),
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log("config written to demo/paymaster/config.json");
