---
title: Stacked PRs
description: How to open a PR on top of another PR with the gh CLI, so GitHub shows the stack instead of a 900-line diff
tags: [convention, workflow, git]
related:
  - "[[contributing]]"
  - "[[review-findings]]"
  - "[[commands]]"
last-reviewed: 2026-08-19
---

# Stacked PRs

One goal, several PRs, each reviewable on its own. PR 2 branches off PR 1's branch instead of `main`, so its diff shows only its own work.

GitHub does not infer this. A PR's base branch is set when the PR is created and never changes on its own. Open a stacked PR without saying so and GitHub bases it on `main`, the diff contains the parent's commits as well, and the stack has to be repaired by hand in the web UI.

Everything below is the CLI equivalent of that repair, done up front.

## Naming the base

Three ways, in preference order.

### 1. Set the merge base when the worktree is created

`gh pr create` reads `branch.<current>.gh-merge-base` from git config. Set it once and every later `gh pr create` on that branch targets the parent, with no flag to forget:

```bash
git worktree add /Users/ac/.work/osn.git/<dir> -b <prefix>/<slug> <parent-branch>
git -C /Users/ac/.work/osn.git/<dir> config branch.<prefix>/<slug>.gh-merge-base <parent-branch>
```

Note the branch is cut from `<parent-branch>`, not `origin/main` — a stacked branch that starts at `main` has nothing to stack on.

For the bottom of a stack, cut from `origin/main` as usual and set nothing; `main` is already the default.

### 2. Pass the base at creation

```bash
gh pr create --base <parent-branch> --title "…" --body-file <path>
```

`--base` is the branch the code merges **into**. Use it when the config was not set, or in a checkout that is not a worktree (the Claude Code remote environment).

### 3. Repair an already-open PR

```bash
gh pr edit <number> --base <parent-branch>
```

Same effect as changing the base in the web UI. Retargeting rewrites the diff; re-read it before asking for review.

## Verify the stack

Never assume. After opening the PRs:

```bash
gh pr list --repo xchromo/osn --state open --json number,headRefName,baseRefName
```

Every PR but the bottom one must show its parent's branch in `baseRefName`. A PR showing `main` is not stacked.

## Merge order

Bottom up, one at a time. When PR 1 merges, GitHub automatically retargets PR 2 to `main` and drops PR 1's commits from its diff — no rebase, no force-push, provided PR 1 was merged rather than closed.

Merging out of order, or closing a parent without merging, orphans the children: their base branch is deleted and the diff turns into everything since `main`. If that happens, `git rebase --onto main <old-parent> <child>` and `gh pr edit <child> --base main`.

Squash-merging a parent is fine. The child's commits are unaffected; only the base pointer moves.

## Rebasing a stack

When `main` moves under a stack, rebase from the bottom and force-push each branch in order:

```bash
git rebase origin/main <bottom>          && git push --force-with-lease origin <bottom>
git rebase --onto <bottom> <old-base> <middle> && git push --force-with-lease origin <middle>
```

`--force-with-lease`, never `--force`. After any rebase, re-assert the property the PR was opened for — resolving a conflict can drop a fix while the diff still reads correctly.

## CI on a stacked PR

Path-filtered jobs must diff against the PR's own base, not `main`, or a stacked PR sees its parent's files as changed. `.github/workflows/ci-swift.yml` does this: on `pull_request` it diffs `origin/$BASE_REF`. Copy that shape for any new filter.

Changeset checks behave the same way — a stacked PR whose parent already carries the changeset does not need a second one.

## When to stack, and when not to

Stack when the pieces share one goal and later pieces read the earlier ones' code. Do not stack for unrelated work: two independent PRs off `main` merge in either order and never block each other.

Keep a stack short. Three deep is manageable; five means the bottom PR sat unreviewed too long.

## Related

- [[contributing]] — branch strategy, changesets, the rest of the PR workflow
- `.claude/commands/prep-pr.md` — the command that opens these PRs
