#!/usr/bin/env bash
# AevumPay demo: one session card, real transactions on QDay Aevum testnet (44005).
#   1) charge inside cap          -> status 1, merchant paid, Charged receipt emitted
#   2) charge beyond cap          -> status 0, on-chain revert reason CapExceeded
#   3) charge after payer revokes -> status 0, on-chain revert reason CardRevokedErr
# Roles: payer = your funded wallet (.env PRIVATE_KEY); agent = throwaway key (.env.demo)
# Re-runnable: every run opens a fresh card with a time-based salt.
set -uo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; . ./.env.demo; set +a
RPC="${RPC_URL:-https://rpc-test.qday.info}"
PAY="${AEVUMPAY_ADDRESS:-0x6728d94b8e24960556f5a731761974a1774c3abe}"
TOKEN="${TUSD8_ADDRESS:-0x456569838f1d43009A91ebA4263147Afd7233483}"

payer=$(cast wallet address --private-key "$PRIVATE_KEY")
agent=$(cast wallet address --private-key "$AGENT_PRIVATE_KEY")
expiry=$(( $(date +%s) + 86400 ))
salt=$(date +%s)
cap=50000          # 0.05 tUSD8
price=10000        # 0.01 tUSD8 per unit
rid=$(cast keccak "api.infer.small")
GAS=400000

run() { # run <label> <pk> <to> <sig> [args...]
  local label=$1 pk=$2 to=$3; shift 3
  local out hash status
  out=$(cast send --legacy --gas-limit "$GAS" --private-key "$pk" --rpc-url "$RPC" "$to" "$@" 2>&1)
  hash=$(echo "$out" | grep -E '^transactionHash' | awk '{print $2}')
  status=$(echo "$out" | grep -E '^status' | awk '{print $2}')
  printf '%-42s status=%s  tx=%s\n' "$label" "${status:-?}" "${hash:-none}"
  echo "$out" > "/tmp/aevumpay-$label.log"
}

echo "payer    $payer"
echo "agent    $agent"
echo "contract $PAY"
echo "token    $TOKEN"
echo "salt     $salt"

echo; echo "== setup =="
run fund-agent        "$PRIVATE_KEY"       "$agent" --value 0.05ether
run register-merchant "$AGENT_PRIVATE_KEY" "$PAY"   "registerMerchant()"
run list-resource     "$AGENT_PRIVATE_KEY" "$PAY"   "listResource(bytes32,uint256)" "$rid" "$price"
run approve           "$PRIVATE_KEY"       "$TOKEN" "approve(address,uint256)" "$PAY" "$cap"
run create-card       "$PRIVATE_KEY"       "$PAY"   "createCard(address,address,uint256,uint64,uint256)" "$agent" "$agent" "$cap" "$expiry" "$salt"
card=$(cast keccak "$(cast abi-encode "f(address,address,address,uint256,uint64,uint256)" "$payer" "$agent" "$agent" "$cap" "$expiry" "$salt")")
echo "cardId   $card"

echo; echo "== 1. charge 3 units (0.03 tUSD8) inside the cap =="
run charge-ok "$AGENT_PRIVATE_KEY" "$PAY" "charge(bytes32,bytes32,uint256,bytes32)" "$card" "$rid" 3 "$(cast keccak "receipt-ok")"
echo "merchant tUSD8 = $(cast call "$TOKEN" "balanceOf(address)(uint256)" "$agent" --rpc-url "$RPC" | awk '{print $1}')"
echo "card remaining = $(cast call "$PAY" "remaining(bytes32)(uint256)" "$card" --rpc-url "$RPC" | awk '{print $1}')"

echo; echo "== 2. charge 4 more units (0.04) -> exceeds cap, must revert =="
run charge-over-cap "$AGENT_PRIVATE_KEY" "$PAY" "charge(bytes32,bytes32,uint256,bytes32)" "$card" "$rid" 4 "$(cast keccak "receipt-over")"

echo; echo "== 3. payer revokes the card =="
run revoke "$PRIVATE_KEY" "$PAY" "revokeCard(bytes32)" "$card"

echo; echo "== 4. agent charges again -> must revert (revoked) =="
run charge-revoked "$AGENT_PRIVATE_KEY" "$PAY" "charge(bytes32,bytes32,uint256,bytes32)" "$card" "$rid" 1 "$(cast keccak "receipt-revoked")"

echo; echo "receiptCount = $(cast call "$PAY" "receiptCount()(uint256)" --rpc-url "$RPC" | awk '{print $1}')"
