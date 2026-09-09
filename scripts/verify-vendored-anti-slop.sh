#!/usr/bin/env bash
# tools/oxlint/anti-slop is excluded from oxfmt and ignored by oxlint (see its
# README), specifically so a re-vendor stays a plain copy with no formatting
# noise. That also means an edit to the vendored tree passes every other gate
# unnoticed — this is the one check that would catch it.
#
# `shasum -c` only verifies the paths SHA256SUMS lists — a file ADDED to the
# tree isn't in that list, so it has nothing to check it against and passes
# silently. The diff catches that half: it fails if the tracked file set
# drifts from SHA256SUMS in either direction, added or removed.
#
# `git ls-files`, not `find`: it reads the tracked/staged set, which is what
# this check claims to cover; it lists symlinks (`find -type f` silently
# skips them); it needs no `sed` to strip a `./` prefix; and it works with no
# `bun install` — the CI callers run before or without one.
#
# The `env -u` is what makes that true inside a hook. Git exports `GIT_DIR` to
# every hook it runs, and with it set `git ls-files` ignores the directory it
# was called from and lists the WHOLE repository — 2334 paths here rather than
# the vendored tree's 22, so the diff fails and no commit can be made. It bites
# in a linked worktree, where `GIT_DIR` is an absolute path into
# `.git/worktrees/<name>`. Clearing the three inherited variables puts the
# command back on the ordinary discovery it has when a person runs it by hand.
set -euo pipefail

cd "$(dirname "$0")/.."

cd tools/oxlint/anti-slop
shasum -c SHA256SUMS
diff <(sed 's/^[0-9a-f]*  //' SHA256SUMS | sort) \
     <(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git ls-files |
       grep -v '^SHA256SUMS$' | sort)
