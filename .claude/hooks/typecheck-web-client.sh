#!/bin/bash
# PostToolUse hook (matcher Edit|Write|MultiEdit): typecheck the package the edited file belongs to.
#   web-client/src/**/*.ts(x)  ->  npm run typecheck (web-client; falls back to tsc --noEmit until that script exists)
#   src/**/*.ts(x) at the root  ->  tsc --noEmit -p .   (root tsconfig; ~1 s cold, so it is cheap enough to run inline)
# Anything else exits 0 immediately. On errors the first ~40 lines go to stderr with exit 2, which
# PostToolUse feeds back to the model as context (it cannot undo the edit, only react to it).
set -u
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in *.ts|*.tsx|*.mts|*.cts) ;; *) exit 0 ;; esac

. "$(dirname "$0")/lib.sh"
ROOT=$(repo_root "$FILE")

case "$FILE" in
  "$ROOT"/web-client/src/*)
    DIR="$ROOT/web-client"; LABEL="web-client"
    if has_script "$DIR" typecheck; then CMD=(npm run --silent typecheck --if-present)
    elif [ -x "$DIR/node_modules/.bin/tsc" ]; then CMD=(./node_modules/.bin/tsc --noEmit --pretty false -p .)
    else exit 0; fi ;;
  "$ROOT"/src/*)
    DIR="$ROOT"; LABEL="backend (root tsconfig)"
    [ -x "$DIR/node_modules/.bin/tsc" ] || exit 0
    CMD=(./node_modules/.bin/tsc --noEmit --pretty false -p .) ;;
  *) exit 0 ;;
esac

OUT=$(cd "$DIR" && "${CMD[@]}" 2>&1) && exit 0
{
  echo "Typecheck failed in $LABEL after editing ${FILE#"$ROOT"/} — fix these before moving on:"
  printf '%s\n' "$OUT" | grep -v '^$' | head -n 40
  n=$(printf '%s\n' "$OUT" | grep -c 'error TS'); [ "$n" -gt 40 ] && echo "... ($n errors total, first 40 shown)"
} >&2
exit 2
