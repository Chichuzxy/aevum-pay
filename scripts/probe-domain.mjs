// One-off probe: find the EIP-712 domain (name/version) of tUSD8 by matching DOMAIN_SEPARATOR.
import { createPublicClient, http, keccak256, encodeAbiParameters, toHex, pad } from "viem";

const RPC = "https://rpc-test.qday.info";
const TOKEN = "0x456569838f1d43009A91ebA4263147Afd7233483";
const CHAIN_ID = 44005;

const client = createPublicClient({ transport: http(RPC) });

const domSep = await client.readContract({
  address: TOKEN,
  abi: [{ name: "DOMAIN_SEPARATOR", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }],
  functionName: "DOMAIN_SEPARATOR",
});
console.log("on-chain DOMAIN_SEPARATOR", domSep);

const name = await client
  .readContract({
    address: TOKEN,
    abi: [{ name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
    functionName: "name",
  })
  .catch((e) => `ERR ${e.shortMessage}`);
console.log("name() ->", JSON.stringify(name));

const names = ["", "tUSD8", "USD8", "Test USD8", "Test tUSD8", "QDay tUSD8", "Aevum USD8", "QDay Aevum Testnet USD8", "USD8 Test Token"];
const versions = ["1", "2", ""];
const typeHash = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));

for (const n of names) {
  for (const v of versions) {
    const hash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [typeHash, keccak256(toHex(n)), keccak256(toHex(v)), BigInt(CHAIN_ID), TOKEN],
      ),
    );
    if (hash.toLowerCase() === domSep.toLowerCase()) console.log(`MATCH name=${JSON.stringify(n)} version=${JSON.stringify(v)}`);
  }
}
