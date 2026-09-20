#!/bin/bash
# Shared helpers for the IrisSpeak Claude Code hooks (sourced, not executed).
# Every hook reads its JSON payload from stdin (see https://code.claude.com/docs/en/hooks), so the
# helpers here take the parsed pieces as arguments. Keep everything quiet on success: hook stdout
# is ignored unless it is JSON, and stderr only reaches the model on exit 2.

# repo_root <path>: the checkout that owns <path>. Uses git so a worktree under .claude/worktrees/
# checks itself rather than the main checkout ($CLAUDE_PROJECT_DIR stays at the main checkout even
# after Claude enters a worktree; the payload's cwd / file_path follow it).
repo_root() {
  local d="$1"
  [ -d "$d" ] || d=$(dirname "$d")
  git -C "$d" rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}"
}

# has_script <pkg-dir> <name>: does <pkg-dir>/package.json define scripts.<name>?
has_script() {
  [ -f "$1/package.json" ] && node -e 'const s=require(process.argv[1]+"/package.json").scripts||{};process.exit(s[process.argv[2]]?0:1)' "$1" "$2" 2>/dev/null
}

# summarise <logfile> <max-lines>: the error-looking lines first, then the tail, capped.
summarise() {
  local log="$1" max="${2:-40}"
  grep -E 'error TS[0-9]+|^ *(✗|×|FAIL|Error|TypeError|ReferenceError)|Error:|failed|✘|[0-9]+ (error|problem)s?' "$log" | head -n "$max"
  echo "--- last lines ---"
  tail -n 15 "$log"
}

# run_check <label> <dir> <cmd...>: run one check, append its output to $LOG on failure, return 1 on failure.
# $LOG and $FAILED are owned by the caller.
run_check() {
  local label="$1" dir="$2"; shift 2
  local out; out=$(mktemp)
  if (cd "$dir" && "$@" >"$out" 2>&1); then rm -f "$out"; return 0; fi
  { echo "### $label FAILED ($*)"; cat "$out"; echo; } >>"$LOG"
  FAILED="$FAILED $label"; rm -f "$out"; return 1
}

# fast_checks <root>: the quick verify subset — root unit tests, web-client typecheck + lint + test.
# Every npm script is optional (--if-present) so this works before the scripts land; typecheck
# falls back to plain tsc while web-client has no "typecheck" script yet. Never boots servers.
fast_checks() {
  local root="$1" wc="$1/web-client"
  FAILED=""
  run_check "root:test" "$root" npm test --silent --if-present
  if has_script "$wc" typecheck; then run_check "web-client:typecheck" "$wc" npm run --silent typecheck
  elif [ -x "$wc/node_modules/.bin/tsc" ]; then run_check "web-client:typecheck(tsc)" "$wc" ./node_modules/.bin/tsc --noEmit --pretty false -p .
  fi
  run_check "web-client:lint" "$wc" npm run --silent lint --if-present
  run_check "web-client:test" "$wc" npm run --silent test --if-present
  [ -z "$FAILED" ]
}
