#!/usr/bin/env bash
# Plant a task that looks mechanical and is not.
#
# The issue is labelled `complexity:2` and reads like a routine refresh: one
# dependency, two changed lines, "no API changes expected". The context file
# then shows what the bump actually is — ioredis 5 to 6, a major, whose
# release notes carry breaking changes to connection handling and to the reply
# encoding that the repository's rate limiter depends on.
#
# Every surface signal points at the `mechanic` definition: a low declared
# complexity, a two-line diff, the word "bump". The rubric's rule points the
# other way — a major version bump is not mechanical work however small the
# diff, because the breaking changes have to be read, understood and applied
# deliberately. The correct answer is `implementer`, and saying so means
# disagreeing with the issue's own label.
#
# This is not hypothetical. Nine of the twelve dependency pull requests in this
# repository's history carried a major bump, and the most expensive single
# pull request in the corpus is this one: ioredis 5 to 6, six sessions, two
# compactions.
set -euo pipefail

rm -rf .claude/commands .claude/projects .claude/evals .claude/tessl.json

git config user.email "eval@example.invalid" 2>/dev/null || true
git config user.name "Tessl Eval" 2>/dev/null || true

if [ ! -d .git ]; then
  git init -q
  git config user.email "eval@example.invalid"
  git config user.name "Tessl Eval"
fi

cat > TASK-ISSUE.md <<'ISSUE'
# xchromo/osn#874 — Bump ioredis

**Type:** Task
**Labels:** `product:shared`, `area:ops`, `complexity:2`

**What** — `ioredis` is behind. Bump it in `shared/redis/package.json` and
refresh the lockfile.

**Why** — Dependency hygiene. It has been pinned for a while and the soak
window has long since passed.

**Done when** — The version is current, `bun run test` passes, and the
lockfile is updated.

**Notes** — Should be a small one. Two lines in a manifest plus the lockfile;
no API changes expected. `shared/redis` is only consumed by
`@shared/rate-limit`.
ISSUE

cat > TASK-CONTEXT.md <<'CONTEXT'
# What the bump actually is

`shared/redis/package.json` currently declares:

    "ioredis": "^5.4.1"

The current release is `6.2.0`.

Extracted from the upstream release notes for 6.0.0:

- **Breaking.** `Redis#connect()` no longer resolves when the connection is
  already established; it rejects instead. Call sites that connect eagerly and
  await unconditionally must be reworked.
- **Breaking.** Replies are decoded as strings by default. Consumers that
  relied on receiving Buffers must opt in explicitly per command.
- **Breaking.** `maxRetriesPerRequest: null` no longer disables retries; the
  option was removed in favour of `enableOfflineQueue`.
- Minimum supported Node raised.

`shared/rate-limit` calls `connect()` at module scope and reads reply values
without decoding them. It is the only consumer.
CONTEXT

mkdir -p .git/info
cat >> .git/info/exclude <<'EXCLUDE'
.claude/
.agents/
DISPATCH.md
EXCLUDE

git add -A 2>/dev/null || true
git commit -qm "eval fixture: a major bump wearing a complexity:2 label" 2>/dev/null || true
