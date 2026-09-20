#!/bin/bash
# PreToolUse hook on Bash: when the command contains `git push`, run the FULL verify (npm run verify at
# the root, which the contract says includes the playwright e2e that boots :3000/:4200 if they are not
# up) and block the push with exit 2 if anything fails. While the root has no "verify" script yet,
# falls back to the fast subset so a red tree still cannot be pushed. Any other Bash command exits 0
# at once. settings.json gives this hook a 600 s ceiling.
set -u
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$CMD" ] || exit 0
# `git push`, `git -C dir push`, `git --no-pager push`, inside && / ; / | chains; not "git pushed" or "git log | grep push".
printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:](])git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+push([[:space:];&|)]|$)' || exit 0

. "$(dirname "$0")/lib.sh"
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null); [ -d "$CWD" ] || CWD="${CLAUDE_PROJECT_DIR:-$PWD}"
ROOT=$(repo_root "$CWD")
[ -f "$ROOT/package.json" ] || exit 0

LOG=$(mktemp)
if has_script "$ROOT" verify; then
  FAILED=""; run_check "verify" "$ROOT" npm run --silent verify; MODE="npm run verify"
else
  fast_checks "$ROOT"; MODE="fast subset (root has no 'verify' script yet)"
fi
if [ -z "$FAILED" ]; then rm -f "$LOG"; exit 0; fi
{
  echo "git push blocked: $MODE failed —${FAILED}. Fix and re-run before pushing."
  summarise "$LOG" 40
} >&2
rm -f "$LOG"
exit 2
