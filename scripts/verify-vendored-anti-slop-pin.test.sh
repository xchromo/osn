#!/usr/bin/env bash
# Tests for verify-vendored-anti-slop-pin.sh. Plain-bash assertions, matching
# the sibling shell tests under scripts/.
#
# Each case builds a throwaway git repo with a base commit and a HEAD commit,
# then runs the real guard there with the base commit as its argument. The
# fixtures never touch this repo's own vendored tree.
#
# Run: bash scripts/verify-vendored-anti-slop-pin.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
guard="$here/verify-vendored-anti-slop-pin.sh"
pass=0
fail=0

readme_with() {
  printf '# anti-slop (vendored)\n\nOxlint plugin from upstream,\npinned to commit `%s` (2026-08-14).\n' "$1"
}

# A repo with one vendored file, a README carrying the pin, and a SHA256SUMS —
# committed as the base, so every case below builds its HEAD on top.
make_fixture() {
  local root="$1"
  mkdir -p "$root/scripts" "$root/tools/oxlint/anti-slop/rules"
  cp "$guard" "$root/scripts/verify-vendored-anti-slop-pin.sh"
  printf 'export const plugin = {};\n' > "$root/tools/oxlint/anti-slop/index.ts"
  printf 'export const rule = {};\n' > "$root/tools/oxlint/anti-slop/rules/no-any.ts"
  readme_with aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$root/tools/oxlint/anti-slop/README.md"
  printf 'deadbeef  index.ts\n' > "$root/tools/oxlint/anti-slop/SHA256SUMS"
  git -C "$root" init -q
  git -C "$root" add -A
  git -C "$root" -c user.email=t@t -c user.name=t commit -qm base
}

commit_all() {
  git -C "$1" add -A
  git -C "$1" -c user.email=t@t -c user.name=t commit -qm head
}

# $3 is the expected exit status; $4, when "gitdir", exports GIT_DIR the way git
# does for the hooks it runs.
run_case() {
  local name="$1" root="$2" want="$3" mode="${4:-clean}" got
  if [ "$mode" = "gitdir" ]; then
    GIT_DIR="$root/.git" bash "$root/scripts/verify-vendored-anti-slop-pin.sh" HEAD~1 "$root" >/dev/null 2>&1
  else
    bash "$root/scripts/verify-vendored-anti-slop-pin.sh" HEAD~1 "$root" >/dev/null 2>&1
  fi
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   - $name (exit $got)"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (got exit $got, want $want)"
    fail=$((fail + 1))
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A branch that leaves the vendored tree alone has nothing to prove.
u="$tmp/untouched"
make_fixture "$u"
printf 'unrelated\n' > "$u/scripts/other.sh"
commit_all "$u"
run_case "untouched vendored tree passes" "$u" 0

# Git exports GIT_DIR to every hook it runs; the sibling guard was broken by it
# once, so assert this one is not.
run_case "untouched vendored tree passes with GIT_DIR set" "$u" 0 gitdir

# The case the guard exists for: upstream source edited, pin left alone.
e="$tmp/edited"
make_fixture "$e"
printf 'export const plugin = { tampered: true };\n' > "$e/tools/oxlint/anti-slop/index.ts"
commit_all "$e"
run_case "edited vendored source with an unchanged pin fails" "$e" 1
run_case "edited vendored source with an unchanged pin fails with GIT_DIR set" "$e" 1 gitdir

# A file added to the vendored tree is a change to it, pin or no pin.
a="$tmp/added"
make_fixture "$a"
printf 'export const rule = {};\n' > "$a/tools/oxlint/anti-slop/rules/smuggled.ts"
commit_all "$a"
run_case "a file added to the vendored tree with an unchanged pin fails" "$a" 1

# ...and so is a removal.
d="$tmp/deleted"
make_fixture "$d"
git -C "$d" rm -q tools/oxlint/anti-slop/rules/no-any.ts
git -C "$d" -c user.email=t@t -c user.name=t commit -qm head
run_case "a file removed from the vendored tree with an unchanged pin fails" "$d" 1

# A real re-vendor: source changed and the pin moved with it.
r="$tmp/revendored"
make_fixture "$r"
printf 'export const plugin = { v2: true };\n' > "$r/tools/oxlint/anti-slop/index.ts"
readme_with bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb > "$r/tools/oxlint/anti-slop/README.md"
commit_all "$r"
run_case "a re-vendor that moves the pin passes" "$r" 0

# The two exempt files. Prose about the vendoring is repo-authored, and its own
# hash lives in SHA256SUMS — so editing the README forces a regeneration, and
# treating either as vendored source would fire on every typo fix.
x="$tmp/exempt"
make_fixture "$x"
readme_with aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$x/tools/oxlint/anti-slop/README.md"
printf '\nA new paragraph about the re-vendor recipe.\n' >> "$x/tools/oxlint/anti-slop/README.md"
printf 'cafebabe  index.ts\n' > "$x/tools/oxlint/anti-slop/SHA256SUMS"
commit_all "$x"
run_case "README.md and SHA256SUMS alone are exempt" "$x" 0

# A README that has lost its pin line cannot be checked against anything, and
# saying so beats passing quietly.
n="$tmp/nopin"
make_fixture "$n"
printf 'export const plugin = { tampered: true };\n' > "$n/tools/oxlint/anti-slop/index.ts"
printf '# anti-slop (vendored)\n\nNo pin here any more.\n' > "$n/tools/oxlint/anti-slop/README.md"
commit_all "$n"
run_case "a vendored change with no pin line at HEAD fails" "$n" 1

# A base ref the checkout does not have is a workflow bug, not a vendoring
# problem — exit 2 keeps the two apart.
b="$tmp/badbase"
make_fixture "$b"
printf 'unrelated\n' > "$b/scripts/other.sh"
commit_all "$b"
bash "$b/scripts/verify-vendored-anti-slop-pin.sh" no-such-ref "$b" >/dev/null 2>&1
got=$?
if [ "$got" -eq 2 ]; then
  echo "ok   - an unfetched base ref exits 2 (exit $got)"
  pass=$((pass + 1))
else
  echo "FAIL - an unfetched base ref exits 2 (got exit $got, want 2)"
  fail=$((fail + 1))
fi

# No base ref at all is the same class of mistake.
bash "$b/scripts/verify-vendored-anti-slop-pin.sh" >/dev/null 2>&1
got=$?
if [ "$got" -eq 2 ]; then
  echo "ok   - a missing base ref argument exits 2 (exit $got)"
  pass=$((pass + 1))
else
  echo "FAIL - a missing base ref argument exits 2 (got exit $got, want 2)"
  fail=$((fail + 1))
fi

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
