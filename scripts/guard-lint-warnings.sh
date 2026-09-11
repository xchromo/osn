#!/usr/bin/env bash
# Guard the count of `bun run lint` warning-severity diagnostics across the
# whole monorepo.
#
# xchromo/osn#1008: oxlintrc.json puts every non-`correctness` category at
# `warn`, so `bun run lint` exits 0 whatever the warning count is — the CI
# step at ci.yml's `lint` job proves only that no error-level rule fired.
# Some of those warn-level rules are repo-specific and exist because the
# mistake they catch actually happened (`house/no-tracker-ref-in-comment`,
# `house/no-non-subscribing-store-read`), and with nothing enforcing the
# total they are advisory notes nobody reads. Over one recent epic the count
# drifted 1020 -> 1035 -> 1037 -> 1059 with no CI step noticing — the only
# way to know was to read the number by hand on every branch.
#
# Mirrors scripts/guard-bundle-size.sh's two rules for a guard that gates on
# a number (wiki/conventions/bundle-size-guards.md):
#
#   - the ceiling lives in ONE committed file this script reads
#     (scripts/lint-warning-ceiling.txt), never a call-site argument and
#     never typed into ci.yml. Missing or unparseable, this script refuses
#     to run rather than passing with nothing to check against.
#   - the headroom is smaller than the smallest mistake the guard exists to
#     catch. The smallest mistake here is one new warning, so the headroom
#     is ZERO: the ceiling is the exact current count. That makes this a
#     ratchet in BOTH directions — a count BELOW the ceiling fails too, with
#     a message to lower the file, because otherwise a cleanup's slack lets
#     the count drift back to where it started with nothing noticing.
#
# Usage:
#   guard-lint-warnings.sh          # what ci.yml's `lint` job calls, as its
#                                     own step after the existing `bun run
#                                     lint` step (so "a rule errored" and
#                                     "the count moved" read as two different
#                                     failures)
#
# Counting method: oxlint's human-readable output has no summary line to
# grep for in the pinned version (verified: a clean run ends on the last
# diagnostic, nothing printed after it), and grepping the word "warning"
# over that output would also match it appearing inside a rule's own
# message or a file path. `--format=json` instead gives one object per
# diagnostic with an explicit `"severity": "warning" | "error"` field,
# stamped by oxlint itself — filtering on that field is exact regardless of
# message wording or output layout. scripts/lint-warning-count.ts does the
# counting (unit-tested against a fixture report in
# scripts/tests/lint-warning-count.test.ts); this script owns running the
# real oxlint, reading the ceiling file, and the pass/fail decision.
#
# LINT_WARNING_CEILING_FILE overrides the ceiling file path, LINT_WARNING_ROOT
# overrides the directory oxlint runs in (real usage: the repo root, matching
# `bun run lint`'s own "."), and LINT_WARNING_OXLINT_BIN overrides the oxlint
# binary path (default: LINT_WARNING_ROOT's own node_modules/.bin/oxlint —
# the same binary `bun run lint` resolves to). scripts/tests/guard-lint-warnings.test.sh
# uses all three to point this script at a small fixture project instead of
# the real monorepo, while still running the REAL oxlint binary from this
# checkout's own node_modules.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEILING_FILE="${LINT_WARNING_CEILING_FILE:-$SCRIPT_DIR/lint-warning-ceiling.txt}"
LINT_ROOT="${LINT_WARNING_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
OXLINT_BIN="${LINT_WARNING_OXLINT_BIN:-$LINT_ROOT/node_modules/.bin/oxlint}"

if [ ! -f "$CEILING_FILE" ]; then
  echo "::error::guard-lint-warnings.sh: ceiling file not found: ${CEILING_FILE} — refusing to run rather than pass with nothing to check the count against." >&2
  exit 1
fi

# One non-negative integer, alone on the first non-blank, non-comment line
# (the same `#`-comment convention as bundle-size-budgets.txt). Fails closed
# on anything else — a malformed file stops the guard rather than silently
# parsing to 0 or to the wrong token.
ceiling=""
while IFS= read -r line || [ -n "$line" ]; do
  stripped="${line%%#*}"
  stripped="$(printf '%s' "$stripped" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -z "$stripped" ] && continue
  ceiling="$stripped"
  break
done <"$CEILING_FILE"

if [ -z "$ceiling" ] || ! [[ "$ceiling" =~ ^[0-9]+$ ]]; then
  echo "::error::guard-lint-warnings.sh: ${CEILING_FILE} does not hold a single non-negative integer ceiling on its first non-comment line — refusing to run." >&2
  exit 1
fi

if [ ! -x "$OXLINT_BIN" ]; then
  echo "::error::guard-lint-warnings.sh: oxlint binary not found or not executable at ${OXLINT_BIN} — run \`bun install\` first." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Same invocation `bun run lint` makes (oxlint -c oxlintrc.json .), plus
# --format=json, run from LINT_ROOT so relative paths in the config and the
# "." target resolve exactly the way they do for that script.
set +e
(cd "$LINT_ROOT" && "$OXLINT_BIN" -c oxlintrc.json . --format=json) >"$WORK_DIR/oxlint.json" 2>"$WORK_DIR/oxlint.stderr"
oxlint_exit=$?
set -e

if [ "$oxlint_exit" -ne 0 ]; then
  echo "::error::guard-lint-warnings.sh: oxlint exited with status ${oxlint_exit} — an error-level rule fired, not just warnings. Run \`bun run lint\` to see it; this guard only checks the warning count and cannot make a meaningful comparison while lint itself is failing." >&2
  cat "$WORK_DIR/oxlint.stderr" >&2
  exit 1
fi

result_file="$WORK_DIR/result.txt"
bun "$SCRIPT_DIR/lint-warning-count.ts" "$WORK_DIR/oxlint.json" >"$result_file"

count="$(head -n1 "$result_file")"
if ! [[ "$count" =~ ^[0-9]+$ ]]; then
  echo "::error::guard-lint-warnings.sh: could not determine a warning count from oxlint's output." >&2
  exit 1
fi

if [ "$count" -eq "$ceiling" ]; then
  echo "guard-lint-warnings.sh: ${count} lint warnings, matches the ceiling in ${CEILING_FILE}."
  exit 0
fi

if [ "$count" -gt "$ceiling" ]; then
  delta=$((count - ceiling))
  echo "::error::guard-lint-warnings.sh: ${count} lint warnings exceeds the ceiling of ${ceiling} in ${CEILING_FILE} by ${delta}. This branch added at least one new warning. Warnings by rule (highest first):" >&2
  tail -n +2 "$result_file" | sed 's/^/  /' >&2
  echo "Run \`bun run lint\` locally to see file:line locations for the rule(s) above. If the new warning(s) are intentional, edit ONLY ${CEILING_FILE} and set it to ${count}." >&2
  exit 1
fi

delta=$((ceiling - count))
echo "::error::guard-lint-warnings.sh: ${count} lint warnings is below the ceiling of ${ceiling} in ${CEILING_FILE} by ${delta}. Warnings were fixed — good — but the ceiling has to ratchet down with them, or the count can silently drift back up before anything notices. Edit ONLY ${CEILING_FILE} and set it to ${count}." >&2
exit 1
