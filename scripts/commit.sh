#!/usr/bin/env bash
# Commit gate: format + tests before every commit, because this Windows box cannot run
# git hooks (Permission denied), and CI's `forge fmt --check` is the only other gate.
#   bash scripts/commit.sh "your message"
set -euo pipefail
msg="${1:-chore: update}"
cd "$(dirname "$0")/.."

if command -v forge >/dev/null 2>&1; then
  echo "== forge fmt =="
  forge fmt
  echo "== forge test =="
  forge test --summary 2>&1 | tail -3
fi

git add -A
git -c user.name="Chichuzxy" -c user.email="Chichuzxy@users.noreply.github.com" commit -m "$msg"
echo
echo "committed. push with:"
echo '  git -c "http.https://github.com.proxy=" -c "https.https://github.com.proxy=" push origin main'
