import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash, toPackedUserOperation } from "viem/account-abstraction";
import { createAevumPay, AEVUMPAY_ABI } from "../sdk/src/index.js";

const RPC = process.env.RPC ?? "https://rpc-test.qday.info";
const cfg = JSON.parse(readFileSync(new URL("../demo/4337/config.json", import.meta.url), "utf8"));
const readEnv = (f) =>
  Object.fromEntries(
    readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const env = { ...readEnv(".env"), ...readEnv(".env.demo") };
const agent = privateKeyToAccount(env.AGENT_PRIVATE_KEY.startsWith("0x") ? env.AGENT_PRIVATE_KEY : `0x${env.AGENT_PRIVATE_KEY}`);

const publicClient = createPublicClient({ transport: http(RPC) });
const pay = createAevumPay({ rpcUrl: RPC });
const ACCOUNT_ABI = parseAbi(["function execute(address dest, uint256 value, bytes data)"]);
const gasPrice = await publicClient.getGasPrice();
const account = cfg.account;
const ENT = entryPoint07Address;

const nonce = await publicClient.readContract({ address: ENT, abi: entryPoint07Abi, functionName: "getNonce", args: [account, 0n] });
const callData = encodeFunctionData({
  abi: ACCOUNT_ABI,
  functionName: "execute",
  args: [pay.contract, 0n, encodeFunctionData({ abi: AEVUMPAY_ABI, functionName: "charge", args: [cfg.cardId, pay.resourceId("api.x402.infer"), 1n, keccak256(toHex("debug"))] })],
});
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
const userOpHash = getUserOperationHash({ userOperation, entryPointAddress: ENT, entryPointVersion: "0.7", chainId: 44005 });
userOperation.signature = await agent.sign({ hash: userOpHash });
console.log("nonce", nonce, "hash", userOpHash, "sig", userOperation.signature.slice(0, 20));

// 1) does validateUserOp accept it when called directly by the EntryPoint? (can't prank on-chain)
// 2) ask the EntryPoint why it fails, via eth_call and dump everything
const packed = toPackedUserOperation(userOperation);
try {
  const res = await publicClient.call({
    to: ENT,
    data: encodeFunctionData({ abi: entryPoint07Abi, functionName: "handleOps", args: [[packed], agent.address] }),
    account: agent.address,
  });
  console.log("call ok?", res);
} catch (e) {
  console.log("name", e.name);
  console.log("short", e.shortMessage);
  console.log("details", e.details);
  console.log("data", JSON.stringify(e.data)?.slice(0, 400));
  console.log("cause", e.cause?.name, e.cause?.shortMessage, JSON.stringify(e.cause?.data)?.slice(0, 400));
  console.log("meta", JSON.stringify(e.metaMessages)?.slice(0, 400));
}
