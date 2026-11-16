// EIP-712 helpers for the gasless (EIP-3009) charge path.
import { encodeAbiParameters, keccak256, parseSignature, toHex } from "viem";
import { TUSD8_DOMAIN, CHAIN_ID } from "./constants.js";

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export const EIP712_DOMAIN_TYPEHASH = keccak256(
  toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

/** The nonce AevumPay will pass to the token: keccak256(abi.encode(payContract, cardId, amount, salt)). */
export function authorizationNonce({ payContract, cardId, amount, salt }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
      [payContract, cardId, amount, BigInt(salt)],
    ),
  );
}

/** cardId as AevumPay.createCard derives it. */
export function computeCardId({ payer, spender, merchant, cap, expiry, salt }) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint256" },
      ],
      [payer, spender, merchant, BigInt(cap), BigInt(expiry), BigInt(salt)],
    ),
  );
}

/** Local EIP-712 domain separator, so callers can assert it equals the token's. */
export function domainSeparator({ name = TUSD8_DOMAIN.name, version = TUSD8_DOMAIN.version, chainId = CHAIN_ID, token }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [EIP712_DOMAIN_TYPEHASH, keccak256(toHex(name)), keccak256(toHex(version)), BigInt(chainId), token],
    ),
  );
}

export function tokenDomain({ token, chainId = CHAIN_ID, name, version }) {
  return {
    name: name ?? TUSD8_DOMAIN.name,
    version: version ?? TUSD8_DOMAIN.version,
    chainId,
    verifyingContract: token,
  };
}

/**
 * Payer signs an EIP-3009 ReceiveWithAuthorization for a metered charge.
 * Nothing is sent on-chain here — the agent submits the returned struct.
 * @returns {Promise<{auth:{validAfter:bigint,validBefore:bigint,salt:bigint,v:number,r:string,s:string}, nonce:string, signature:string}>}
 */
export async function signGaslessCharge({
  payerAccount,
  payContract,
  token,
  cardId,
  amount,
  salt,
  validBefore,
  validAfter = 0n,
  chainId = CHAIN_ID,
  name,
  version,
}) {
  const nonce = authorizationNonce({ payContract, cardId, amount, salt });
  const signature = await payerAccount.signTypedData({
    domain: tokenDomain({ token, chainId, name, version }),
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: payerAccount.address,
      to: payContract,
      value: BigInt(amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });
  const { v, r, s } = parseSignature(signature);
  return {
    auth: { validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), salt: BigInt(salt), v: Number(v), r, s },
    nonce,
    signature,
  };
}
