#!/usr/bin/env bash
# Put the monorepo into a state where its workspaces disagree about a few
# shared dependencies, with the lockfile kept consistent with every edit.
#
# Which packages, which workspaces, and what the right alignment is are in
# `criteria.json` and are deliberately not repeated here: this script runs
# inside the checkout the agent then audits.
set -euo pipefail

# The fixture repo carries `.claude/commands/*.md` — verbatim copies of the
# skills under test, including the whole report specification. `exclude` in
# scenario.json does not actually strip them, so the baseline would read the
# very content the eval withholds. Delete every copy. The plugin variant
# supplies `.claude/skills/`, which nothing here touches.
rm -rf .claude/commands .claude/projects .claude/evals .claude/tessl.json
git config user.email "eval@example.invalid" 2>/dev/null || true
git config user.name "Tessl Eval" 2>/dev/null || true

# A commit fixture may install the tree without its `.git`. Normalise that.
if [ ! -d .git ]; then
  git init -q
  git config user.email "eval@example.invalid"
  git config user.name "Tessl Eval"
fi

# The harness injects the plugin as symlinks under `.claude/` and `.agents/`,
# and only into the with-context variant. Left visible they show up as working
# -tree changes in that variant alone, which the no-edits check then scores
# against it. Ignore them in both variants so the guard measures the agent,
# not the harness.
mkdir -p .git/info
printf '.claude/\n.agents/\n' >> .git/info/exclude

# Set a declared range in one workspace's package.json AND in the lockfile's
# copy of that workspace's manifest, so `bun install --frozen-lockfile` would
# still be satisfied — every new range still admits the version the lockfile
# resolved. Arguments: workspace dir, package, old range, new range.
set_range() {
  local ws="$1" pkg="$2" old="$3" new="$4"
  WS="$ws" PKG="$pkg" OLD="$old" NEW="$new" perl -pi -e '
    s{("\Q$ENV{PKG}\E": )"\Q$ENV{OLD}\E"}{$1"$ENV{NEW}"}' "$ws/package.json"
  grep -q "\"$pkg\": \"$new\"" "$ws/package.json"
  WS="$ws" PKG="$pkg" OLD="$old" NEW="$new" perl -0pi -e '
    s{("\Q$ENV{WS}\E": \{.*?"\Q$ENV{PKG}\E": )"\Q$ENV{OLD}\E"}{$1"$ENV{NEW}"}s' bun.lock
  grep -q "\"$pkg\": \"$new\"" bun.lock
}

set_range zap/api           effect      '^3.22.0'  '^3.21.0'
set_range osn/client        effect      '^3.22.0'  '^3.20.2'
set_range pulse/db          drizzle-orm '^0.45.2'  '^0.45.0'
set_range shared/rate-limit vitest      '^4.1.10'  '~4.1.8'

git add -A
git diff --cached --quiet || git commit -qm "fixture: install state"

git checkout -q -B main

# Nothing here fetches, but a remote that resolves keeps a probe from burning
# turns on a network error the task then has to explain away.
git remote remove origin 2>/dev/null || true
git remote add origin "$PWD"
