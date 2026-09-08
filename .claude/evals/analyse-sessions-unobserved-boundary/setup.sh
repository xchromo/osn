#!/usr/bin/env bash
# Plant a card corpus whose naive reading gives a confident wrong answer.
#
# Twelve cards. Seven of them have `tokens_before_first_edit: null` — the
# transcript showed no edit the collector could recognise, so the first-edit
# boundary was never observed — and six of those seven touch `cire/host`. An
# agent that treats a null boundary as "all of it was exploration" ranks
# `cire/host` at or near 100% and names it as the package most needing
# documentation. That is the exact failure this scenario exists to catch: it
# happened for real, `cire/host` was reported at 62%, and it reads 5% once the
# nulls are excluded.
#
# The five cards with an observed boundary carry modest, unremarkable shares
# spread across four packages, on samples of one or two. Nothing in the corpus
# supports naming a worst-mapped package, and saying so is the correct answer.
#
# Nothing is rated: every card is `complexity: none`. So the coverage check
# also has something true to report, and any cost-versus-difficulty claim is
# unsupported.
set -euo pipefail

# The fixture commit ships this repository's own skills. Delete the copies the
# harness would otherwise let the baseline read, exactly as the other scenarios
# here do. The plugin variant supplies `.claude/skills/` separately.
rm -rf .claude/commands .claude/projects .claude/evals .claude/tessl.json

git config user.email "eval@example.invalid" 2>/dev/null || true
git config user.name "Tessl Eval" 2>/dev/null || true

if [ ! -d .git ]; then
  git init -q
  git config user.email "eval@example.invalid"
  git config user.name "Tessl Eval"
fi

mkdir -p .claude/metrics

# card <n> <branch> <package> <usd> <output-tokens> <cache-read> <before-first-edit|null>
card() {
  local n="$1" branch="$2" pkg="$3" usd="$4" out="$5" read="$6" before="$7"
  cat > ".claude/metrics/${branch//\//-}.json" <<JSON
{
  "schema_version": 1,
  "pr": {
    "number": $n,
    "branch": "$branch",
    "base_sha": "aaaaaaa",
    "head_sha": "bbbbbbb",
    "generated_at": "2026-08-${n}T10:00:00.000Z",
    "merged_at": "2026-08-${n}T12:00:00.000Z",
    "phase": "at-merge"
  },
  "issue": { "number": null, "type": null, "labels": [] },
  "complexity": { "declared": null, "method": "none" },
  "window": {
    "sessions": 2, "first_ts": "2026-08-${n}T10:00:00.000Z",
    "last_ts": "2026-08-${n}T12:00:00.000Z",
    "span_seconds": 7200, "active_seconds": 1500, "compactions": 0
  },
  "spend": {
    "usd_equivalent": $usd,
    "tokens": {
      "input": 0, "output": $out, "thinking": 0,
      "cache_write_5m": 0, "cache_write_1h": 0, "cache_read": $read
    },
    "by_model": {},
    "by_actor": {
      "main": { "tokens": { "input": 0, "output": $out, "thinking": 0, "cache_write_5m": 0, "cache_write_1h": 0, "cache_read": $read }, "usd_equivalent": $usd, "messages": 40 },
      "subagent": { "tokens": { "input": 0, "output": 0, "thinking": 0, "cache_write_5m": 0, "cache_write_1h": 0, "cache_read": 0 }, "usd_equivalent": 0, "messages": 0 }
    },
    "effort": { "high": 40 },
    "unpriced_models": []
  },
  "diff": {
    "files": { "generated": 0, "test": 1, "docs": 0, "config": 0, "source": 3 },
    "loc": {
      "generated": { "added": 0, "deleted": 0 },
      "test": { "added": 40, "deleted": 0 },
      "docs": { "added": 0, "deleted": 0 },
      "config": { "added": 0, "deleted": 0 },
      "source": { "added": 120, "deleted": 30 }
    },
    "packages": ["$pkg"],
    "touches_migration": false,
    "commits": 3
  },
  "interaction": {
    "user_turns": 3,
    "corrective_turns": 1,
    "tokens_before_first_edit": $before,
    "sessions_with_observed_edit": $([ "$before" = "null" ] && echo 0 || echo 2),
    "tool_calls": { "Bash": 40, "Read": 12 },
    "edit_churn": { "files_edited_3plus": 0, "max_edits_one_file": 2 },
    "skills": {},
    "subagents": {}
  }
}
JSON
}

# Seven cards with no observed boundary. Six are cire/host — the trap.
card 11 fix/cire-host-a       cire/host    4.10  50000 4000000 null
card 12 fix/cire-host-b       cire/host    3.20  40000 3000000 null
card 13 perf/cire-host-c      cire/host    5.40  60000 5000000 null
card 14 perf/cire-host-d      cire/host    2.90  30000 2500000 null
card 15 fix/cire-host-e       cire/host    6.10  70000 5500000 null
card 16 chore/cire-host-f     cire/host    3.70  45000 3200000 null
card 17 fix/osn-api-a         osn/api      2.80  35000 2400000 null

# Five with a real boundary, modest shares, thin samples.
card 18 feat/osn-api-b        osn/api      3.10  40000 2000000 260000
card 19 feat/osn-api-c        osn/api      2.40  30000 1700000 190000
card 20 feat/pulse-web-a      pulse/web    3.60  45000 2300000 300000
card 21 feat/cire-api-a       cire/api     2.20  28000 1500000 160000
card 22 feat/cire-host-g      cire/host    2.70  33000 1800000 200000

mkdir -p .git/info
cat >> .git/info/exclude <<'EXCLUDE'
.claude/
.agents/
ANALYSIS.md
EXCLUDE

git add -A 2>/dev/null || true
git commit -qm "eval fixture: a card corpus with unobserved edit boundaries" 2>/dev/null || true
