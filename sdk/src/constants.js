// Chain constants for QDay Aevum testnet (chainId 44005).
export const CHAIN_ID = 44005;
export const RPC_URL = "https://rpc-test.qday.info";
export const EXPLORER = "https://explorer-test.qday.info";

export const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483"; // 6 decimals, EIP-3009 enabled
export const AEVUMPAY = "0x6728d94b8e24960556f5a731761974a1774c3abe"; // v2, gasless capable

// tUSD8 EIP-712 domain. Verified against the token's DOMAIN_SEPARATOR on 44005.
export const TUSD8_DOMAIN = { name: "tUSD8", version: "2" };

// Aevum is a Shanghai-EVM chain: no MCOPY/TSTORE/blob opcodes, no WebSocket RPC,
// and eth_getLogs is capped at 1,000 blocks per call.
export const MAX_LOG_RANGE = 1000n;
