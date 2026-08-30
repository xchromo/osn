#!/usr/bin/env bash
#
# The other vendored-tree guard, `verify-vendored-anti-slop.sh`, proves the tree
# matches its own `SHA256SUMS`. That is a self-certification: regenerate the
# checksums after an edit and the tree certifies whatever it now contains. What
# nothing checked is the claim in `tools/oxlint/anti-slop/README.md` — that this
# directory is a verbatim copy of one named upstream commit.
#
# Rather than fetch the upstream tarball on every run — a network hop in a lint
# job, and a flake whenever GitHub is slow — this asserts the weaker property
# that actually catches the mistake: a change to the vendored source without a
# change to the pinned commit is either an edit to upstream code (which the
# README says never happens) or a re-vendor that forgot to move the pin. Both
# want a human's eyes, and both are invisible to `shasum -c`.
#
# `README.md` and `SHA256SUMS` are exempt. The README is repo-authored prose
# about the vendoring, not upstream source, and its own hash is inside
# `SHA256SUMS`, so editing one forces the other. Treating either as vendored
# source would make this guard fire on every PR that fixes a typo here.
#
# Usage: verify-vendored-anti-slop-pin.sh <base-ref> [repo-root]
#
# The base ref must already be fetched — `actions/checkout` clones at depth 1,
# so the workflow either passes `fetch-depth: 0` or fetches the base SHA first.
set -euo pipefail

# Inherited git env vars would point every command below at whatever repository
# invoked this script, not the one it was told to check — the same reason the
# sibling guard unsets them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

base="${1:-}"
root="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
vendored="tools/oxlint/anti-slop"
readme="$vendored/README.md"

if [ -z "$base" ]; then
  echo "usage: $(basename "$0") <base-ref> [repo-root]" >&2
  exit 2
fi

cd "$root"

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "❌ anti-slop pin: base ref '$base' is not in this checkout." >&2
  echo "   Fetch it first — actions/checkout clones at depth 1." >&2
  exit 2
fi

# `git diff --name-only` over the vendored path, minus the two exempt files.
changed=$(
  git diff --name-only "$base" HEAD -- "$vendored" \
    | grep -v -e "^$vendored/README.md\$" -e "^$vendored/SHA256SUMS\$" || true
)

if [ -z "$changed" ]; then
  echo "✅ anti-slop pin: no vendored source changed against $base."
  exit 0
fi

# The pin as it reads on each side. A missing line is itself a failure: the
# README is the only record of which upstream commit this tree came from.
pin_at() {
  git show "$1:$readme" 2>/dev/null \
    | sed -n 's/.*pinned to commit `\([0-9a-f]\{7,40\}\)`.*/\1/p' \
    | head -n 1
}

pin_head=$(pin_at HEAD)
pin_base=$(pin_at "$base")

if [ -z "$pin_head" ]; then
  echo "❌ anti-slop pin: no 'pinned to commit \`<sha>\`' line in $readme at HEAD." >&2
  exit 1
fi

if [ "$pin_head" != "$pin_base" ]; then
  echo "✅ anti-slop pin: vendored source changed and the pin moved ($pin_base -> $pin_head)."
  exit 0
fi

echo "❌ anti-slop pin: vendored source changed while the pinned upstream commit did not." >&2
echo "" >&2
echo "   Pinned commit (unchanged against $base): $pin_head" >&2
echo "   Changed files:" >&2
echo "$changed" | sed 's/^/     /' >&2
echo "" >&2
echo "   $readme says this tree is a verbatim copy of that commit. Either" >&2
echo "   re-vendor from a newer upstream commit and update the pin, or — if the" >&2
echo "   edit is genuinely wanted — say so in the PR and move the pin anyway, so" >&2
echo "   the next reader knows the tree no longer matches upstream byte for byte." >&2
exit 1
