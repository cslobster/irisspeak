#!/bin/bash
# Stop hook: before the model declares a turn finished, run the FAST verify subset (root unit tests,
# web-client typecheck + lint + test — all optional via --if-present; never e2e, which boots servers).
# Exit 2 with a summary keeps the turn going so the agent fixes the failure instead of stopping red.
#
# Guards, in order: (1) stop_hook_active — we already blocked once this turn, let it end (the docs'
# infinite-loop guard); (2) nothing to verify — tree clean and nothing ahead of upstream;
# (3) fingerprint — the exact same tree already passed in this session, skip the re-run.
set -u
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0

. "$(dirname "$0")/lib.sh"
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null); [ -d "$CWD" ] || CWD="${CLAUDE_PROJECT_DIR:-$PWD}"
ROOT=$(repo_root "$CWD")
[ -f "$ROOT/package.json" ] || exit 0

DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null)
AHEAD=$(git -C "$ROOT" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
[ -z "$DIRTY" ] && [ "${AHEAD:-0}" = "0" ] && exit 0

STAMP_DIR=$(printf '%s' "$INPUT" | jq -r '.scratchpad_dir // empty' 2>/dev/null); [ -d "$STAMP_DIR" ] || STAMP_DIR="${TMPDIR:-/tmp}"
STAMP="$STAMP_DIR/.irisspeak-stop-verify-$(printf '%s' "$ROOT" | shasum | cut -c1-12)"
# fingerprint = HEAD + status + tracked diff + content hashes of untracked files (a new file edited after a
# green run would otherwise look identical to git status/diff)
FP=$( { git -C "$ROOT" rev-parse HEAD; printf '%s\n' "$DIRTY"; git -C "$ROOT" diff HEAD 2>/dev/null
        git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null | (cd "$ROOT" && git hash-object --stdin-paths 2>/dev/null); } | shasum | cut -c1-40)
[ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$FP" ] && exit 0

LOG=$(mktemp)
if fast_checks "$ROOT"; then printf '%s' "$FP" >"$STAMP"; rm -f "$LOG"; exit 0; fi
{
  echo "Verify (fast subset) is red — do not stop yet. Failed:${FAILED}."
  echo "Fix the failures below, then finish. (Full run: npm run verify; e2e is only run before git push.)"
  summarise "$LOG" 40
} >&2
rm -f "$LOG"
exit 2
