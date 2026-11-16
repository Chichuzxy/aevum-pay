// AevumPay SDK client: session cards, metered charges, gasless EIP-3009 settlement
// and chunked receipt reads for QDay Aevum testnet (chainId 44005).
import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { AEVUMPAY_ABI, ERC20_MIN_ABI } from "./abi.js";
import { AEVUMPAY, TUSD8, RPC_URL, CHAIN_ID, MAX_LOG_RANGE } from "./constants.js";
import { computeCardId, signGaslessCharge, authorizationNonce } from "./eip3009.js";

/**
 * @param {{rpcUrl?:string, contract?:string, token?:string, chainId?:number}} [opts]
 */
export function createAevumPay(opts = {}) {
  const rpcUrl = opts.rpcUrl ?? RPC_URL;
  const contract = opts.contract ?? AEVUMPAY;
  const token = opts.token ?? TUSD8;
  const chainId = opts.chainId ?? CHAIN_ID;

  const publicClient = opts.publicClient ?? createPublicClient({ transport: http(rpcUrl) });
  const walletFor = (account) => createWalletClient({ account, transport: http(rpcUrl) });

  // QDay accepts legacy transactions; being explicit avoids fee-market surprises.
  const send = async (account, address, abi, functionName, args) => {
    const walletClient = walletFor(account);
    const gasPrice = await publicClient.getGasPrice();
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      chain: null,
      gasPrice,
      type: "legacy",
    });
    return publicClient.waitForTransactionReceipt({ hash });
  };

  return {
    contract,
    token,
    publicClient,

    // ---------------------------------------------------------------- reads

    /** @returns {Promise<{merchant:string, unitPrice:bigint, active:boolean}>} */
    quote: (resourceId) =>
      publicClient
        .readContract({ address: contract, abi: AEVUMPAY_ABI, functionName: "resources", args: [resourceId] })
        .then(([merchant, unitPrice, active]) => ({ merchant, unitPrice, active })),

    /** Price for `units` of a resource, or null when the resource is inactive. */
    priceFor: async (resourceId, units) => {
      const { unitPrice, active } = await (async () =>
        publicClient
          .readContract({ address: contract, abi: AEVUMPAY_ABI, functionName: "resources", args: [resourceId] })
          .then(([merchant, unitPrice, active]) => ({ merchant, unitPrice, active })))();
      return active ? unitPrice * BigInt(units) : null;
    },

    card: (cardId) =>
      publicClient
        .readContract({ address: contract, abi: AEVUMPAY_ABI, functionName: "cards", args: [cardId] })
        .then(([payer, merchant, spender, cap, spent, expiry, revoked]) => ({
          payer,
          merchant,
          spender,
          cap,
          spent,
          expiry,
          revoked,
          remaining: cap - spent,
        })),

    remaining: (cardId) => publicClient.readContract({ address: contract, abi: AEVUMPAY_ABI, functionName: "remaining", args: [cardId] }),

    balanceOf: (address) => publicClient.readContract({ address: token, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [address] }),

    cardId: computeCardId,
    nonceFor: (cardId, amount, salt) => authorizationNonce({ payContract: contract, cardId, amount, salt }),

    /** On-chain DOMAIN_SEPARATOR of tUSD8, for asserting the local EIP-712 domain. */
    tokenDomainSeparator: () =>
      publicClient.readContract({ address: token, abi: ERC20_MIN_ABI, functionName: "DOMAIN_SEPARATOR" }),

    /**
     * Charged receipts, oldest first. eth_getLogs on Aevum is capped at 1,000 blocks,
     * so the range is walked in chunks — pass the deploy block as `fromBlock`.
     */
    async receipts({ fromBlock, toBlock = "latest", cardId, chunkSize = MAX_LOG_RANGE } = {}) {
      const latest = toBlock === "latest" ? await publicClient.getBlockNumber() : BigInt(toBlock);
      const start = BigInt(fromBlock ?? 0n);
      const out = [];
      for (let from = start; from <= latest; from += chunkSize) {
        const to = from + chunkSize - 1n > latest ? latest : from + chunkSize - 1n;
        const logs = await publicClient.getContractEvents({
          address: contract,
          abi: AEVUMPAY_ABI,
          eventName: "Charged",
          fromBlock: from,
          toBlock: to,
          args: cardId ? { cardId } : {},
        });
        for (const log of logs) {
          out.push({
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            cardId: log.args.cardId,
            resourceId: log.args.resourceId,
            payer: log.args.payer,
            merchant: log.args.merchant,
            units: log.args.units,
            amount: log.args.amount,
            receiptHash: log.args.receiptHash,
            receiptIndex: log.args.receiptIndex,
          });
        }
      }
      return out;
    },

    // --------------------------------------------------------------- writes

    registerMerchant: (wallet) => send(wallet, contract, AEVUMPAY_ABI, "registerMerchant", []),
    listResource: (wallet, resourceId, unitPrice) =>
      send(wallet, contract, AEVUMPAY_ABI, "listResource", [resourceId, BigInt(unitPrice)]),
    revokeCard: (wallet, cardId) => send(wallet, contract, AEVUMPAY_ABI, "revokeCard", [cardId]),

    /**
     * Payer opens a metered card: approve the contract, then createCard.
     * @returns {Promise<{cardId:string, approve:object, createCard:object}>}
     */
    async openCard(wallet, { spender, merchant, cap, expiry, salt }) {
      const approveReceipt = await send(wallet, token, ERC20_MIN_ABI, "approve", [contract, BigInt(cap)]);
      const createReceipt = await send(wallet, contract, AEVUMPAY_ABI, "createCard", [
        spender,
        merchant,
        BigInt(cap),
        BigInt(expiry),
        BigInt(salt),
      ]);
      return {
        cardId: computeCardId({ payer: wallet.address, spender, merchant, cap, expiry, salt }),
        approve: approveReceipt,
        createCard: createReceipt,
      };
    },

    /** Approve-based charge (payer already approved; agent pays gas). */
    charge: (wallet, { cardId, resourceId, units, receiptHash }) =>
      send(wallet, contract, AEVUMPAY_ABI, "charge", [cardId, resourceId, BigInt(units), receiptHash]),

    /** Agent signs nothing: it just relays the payer's signature and pays gas. */
    chargeWithAuthorization: (wallet, { cardId, resourceId, units, receiptHash, auth }) =>
      send(wallet, contract, AEVUMPAY_ABI, "chargeWithAuthorization", [
        cardId,
        resourceId,
        BigInt(units),
        receiptHash,
        auth,
      ]),

    /** Off-chain half of the gasless flow: quote the price, then have the payer sign. */
    async prepareGasless({ payerAccount, cardId, resourceId, units, salt, validBefore, validAfter = 0n }) {
      const price = await publicClient.readContract({
        address: contract,
        abi: AEVUMPAY_ABI,
        functionName: "resources",
        args: [resourceId],
      });
      const amount = price[1] * BigInt(units);
      const signed = await signGaslessCharge({
        payerAccount,
        payContract: contract,
        token,
        cardId,
        amount,
        salt,
        validAfter,
        validBefore,
        chainId,
      });
      return { amount, ...signed };
    },

    resourceId: (name) => keccak256(toHex(name)),
  };
}
