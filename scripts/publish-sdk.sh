#!/usr/bin/env bash
# Publish @aevum-pay/sdk to npm. You run this, because the npm token is yours:
#   npm login            # once, with your own account
#   bash scripts/publish-sdk.sh
# Options: --dry to only validate (no publish).
set -euo pipefail
cd "$(dirname "$0")/../sdk"

echo "== tests =="
node --test test/pure.test.js 2>&1 | tail -3

echo "== package contents =="
npm pack --dry-run 2>&1 | grep -E "name:|version:|total files|package size" || true

if [ "${1:-}" = "--dry" ]; then
  echo "dry run only — nothing published"
  exit 0
fi

who=$(npm whoami 2>/dev/null || true)
if [ -z "$who" ]; then
  echo
  echo "not logged in. run:  npm login" >&2
  echo "(2FA users: publish with 'npm publish --otp <code>')" >&2
  exit 1
fi

echo "== publishing as $who =="
npm publish --access public
echo
echo "published. verify with: npm view aevum-pay-sdk version"
