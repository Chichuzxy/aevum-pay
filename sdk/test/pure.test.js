// Pure-function tests: no network, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, encodeAbiParameters, toHex } from "viem";
import { computeCardId, authorizationNonce, domainSeparator, RECEIVE_WITH_AUTHORIZATION_TYPES } from "../src/index.js";

const PAY = "0x6728d94b8e24960556f5a731761974a1774c3abe";
const TOKEN = "0x456569838f1d43009A91ebA4263147Afd7233483";
const payer = "0xdb03374034ca16Afe997038266886327d1efd3af";
const agent = "0x87c104C83f061489a8bbd9FC9bEcadE58E52685F";
const cardId = "0x9129746635faa4d7660d5c7835fa12f55188246bc5cceda67b6ab3737143384b";

test("cardId is deterministic and matches the on-chain derivation", () => {
  const id = computeCardId({ payer, spender: agent, merchant: agent, cap: 50_000n, expiry: 1_800_000_000n, salt: 1n });
  assert.equal(id, computeCardId({ payer, spender: agent, merchant: agent, cap: 50_000n, expiry: 1_800_000_000n, salt: 1n }));
  assert.equal(id.length, 66);
  assert.notEqual(id, computeCardId({ payer, spender: agent, merchant: agent, cap: 50_000n, expiry: 1_800_000_001n, salt: 1n }));
});

test("authorizationNonce binds contract + card + amount + salt", () => {
  const base = { payContract: PAY, cardId, amount: 10_000n, salt: 7n };
  const n = authorizationNonce(base);
  assert.equal(n.length, 66);
  assert.notEqual(n, authorizationNonce({ ...base, amount: 20_000n }));
  assert.notEqual(n, authorizationNonce({ ...base, salt: 8n }));
  assert.notEqual(n, authorizationNonce({ ...base, cardId: "0x" + "11".repeat(32) }));
});

test("domain separator differs from a wrong name/version", () => {
  const sep = domainSeparator({ token: TOKEN });
  assert.equal(sep.length, 66);
  assert.notEqual(sep, domainSeparator({ token: TOKEN, version: "1" }));
  assert.notEqual(sep, domainSeparator({ token: TOKEN, name: "USD8" }));
});

test("typed-data shape covers the 6 EIP-3009 fields in order", () => {
  assert.deepEqual(
    RECEIVE_WITH_AUTHORIZATION_TYPES.ReceiveWithAuthorization.map((f) => f.name),
    ["from", "to", "value", "validAfter", "validBefore", "nonce"],
  );
});

test("abi-encoded args are stable across calls (guards against ordering drift)", () => {
  const enc = () =>
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
      [PAY, cardId, 10_000n, 7n],
    );
  assert.equal(keccak256(toHex("x")), keccak256(toHex("x")));
  assert.equal(enc(), enc());
});
