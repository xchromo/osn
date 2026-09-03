---
name: prep-pr
description: Use when preparing the current branch for a pull request — resolving the base branch, checking changesets, running builds and reviews, filing findings as issues, and opening the PR with the mandatory five-section body.
---

Prepare the current branch for a pull request.

## What this run must produce

Two files, always, whatever else fails:

1. A **PR body** with exactly five `##` sections. The template is in Step 8.
2. A **report** of what was checked, what would fail in CI (named exactly, with
   its fix), and whether the branch is ready.

If the task named the files, use those names; otherwise `PR-BODY.md` and
`PREP-PR-REPORT.md` at the repo root.

**Write the PR body's skeleton now, before Step 0.** The body is the
deliverable, and a body missing a section has failed however good the run was.
Creating it first means the shape is already right and every later step only
fills it in; leaving it to Step 8 is how a section goes missing on a run that
spent its turns elsewhere. Copy this verbatim:

```bash
cat > PR-BODY.md <<'EOF'
## Summary

None

## Workspaces affected

None

## Issues

None

## Decisions

None

## Test plan

None
EOF
```

Those five `##` headings are the whole permitted set, and that is their order.
Replace a `None` as the run establishes what belongs there; leave it where the
answer really is nothing. Never add a sixth `##` — notes about gates that could
not run go in the report file, and a change-specific title goes in the PR title
and in `## Summary`, never as a heading of its own.

## When a step cannot run

The steps below assume a network, `gh`, an installed package manager, and a user
to answer questions. Any of those may be absent.

**Find out which, once, before Step 0.** Discovering it by failing costs a turn
per step and tells you nothing the probe would not have:

```bash
git remote -v && git ls-remote --exit-code origin HEAD >/dev/null 2>&1 && echo "network: yes" || echo "network: no"
command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo "gh: yes" || echo "gh: no"
[ -d node_modules ] && echo "deps: installed" || echo "deps: absent"
```

Write the three answers into the report file straight away, under a heading of
its own. They decide, in advance, which steps run for real and which run their
static equivalent — and a step whose gate you already know is unavailable is
run *statically and immediately*, not attempted. Do not retry a command whose
prerequisite this probe said was absent; do not open, label or comment on an
issue with no network, and never describe as done anything the probe ruled out.

**A static equivalent is a paragraph, not an expedition.** With no network, the
issue steps are the issue you *would* file — title, labels, type, four-field
body — written into the report, and not a hunt through the tracker for one that
might already exist. If the task also says not to modify files, the docs step is
the same: name the pages this branch would change and say what would go in them.
Neither is a reason to go reading the wiki, and neither is a reason to dispatch
an agent. The cost of getting this wrong is not a wrong answer, it is a run that
spends its time somewhere the report never goes.

**No step is a stop, and no step is skipped.** A command that fails, a gate that
cannot execute, or a question with nobody to answer it is not the end of the
step. Do the step's static equivalent first — read the code the gate would have
exercised and state your own verdict — then record in the report file the step's
name, what could not run, and what you concluded without it. "Not run" describes
the gate, never your review: a run that records six "not run" lines and no
analysis has failed as surely as one that stalled waiting. Every one of those
notes goes in the report file; none of them becomes a section of the PR body.
The two artefacts above are produced in every case, including the one where
every gate failed. Never claim a gate passed that you did not run in this
worktree; never claim a remote action succeeded.

Five steps below ask the user something. In a non-interactive run there is no
user: take the conservative default that step names, record the choice under
`## Decisions`, and continue. Waiting for an answer that cannot come is a failed
run.

Run the steps in order.

---

## Step 0 — Resolve the base branch

Every later step diffs against the branch this PR will merge **into**, which is not always `main`. On a stacked branch it is the parent branch, and diffing against `main` reports the parent's files as this PR's changes.

```bash
BASE=$(git config --get branch.$(git branch --show-current).gh-merge-base || echo main)
git fetch origin "$BASE"
echo "base: $BASE"
```

If `BASE` is not `main`, this branch is stacked, and two things follow. Put both in the report, naming `$BASE`, whether or not you can act on them: this PR targets `$BASE` rather than `main`, and **the parent's own PR has to exist first** — GitHub cannot base a pull request on a branch it does not have, so with no parent PR open the ordering is the parent's, then this one. With no network, that ordering is still the finding; state it.

If this branch is stacked but `gh-merge-base` was never set (the config is written at worktree creation — see `[[wiki/conventions/stacked-prs]]`), set it now rather than passing the base by hand:

```bash
git config branch.$(git branch --show-current).gh-merge-base <parent-branch>
```

Use `$BASE` in every `git diff` below and as `--base` in Step 9.

---

## Step 1 — Identify changed workspaces

Run `git diff --name-only "$BASE"...HEAD` to list all changed files.

Map changed files to workspaces using these rules:

- Files under `osn/<name>/` → workspace `osn/<name>`, package `@osn/<name>`
- Files under `pulse/<name>/` → workspace `pulse/<name>`, package `@pulse/<name>`
- Files under `shared/<name>/` → workspace `shared/<name>`, package `@shared/<name>`
- Files under `cire/<name>/` → workspace `cire/<name>`, package `@cire/<name>` — these are **ignored** packages, version-less, so they never share a changeset with a versioned one
- Files under `zap/<name>/` → workspace `zap/<name>`, package `@zap/<name>`
- Files under `tools/<name>/` → workspace `tools/<name>`; the package name is whatever that directory's own `package.json` says and is not always derivable from the path — `tools/oxlint/house` is `@tools/oxlint-house`. Read it, never guess it
- Files on the changeset **allowlist** — `.claude/`, `.github/`, `scripts/`, `wiki/`, `docs/`, `shared/swift/`, `pulse/ios/`, `osn/ios/`, top-level `*.md`, `.gitignore` — need no changeset at all. `scripts/changeset-required.sh` holds the list and decides. Anything off it, including `bun.lock` and root `turbo.json`/`tsconfig.json`, still requires one.

Report: the list of affected workspaces and whether any CI/infra-only files were changed.

---

## Step 2 — Check changesets

Run `git diff --name-only "$BASE"...HEAD -- .changeset/` and filter out `config.json` and `README.md` to find new changeset files on this branch.

**If no new changeset files exist:**

- Summarise the changes (from the step 1 diff) in 1–2 sentences suitable for a changeset summary.
- Present this summary to the user and ask them to confirm or edit it. With no user to
  answer, adopt the summary you drafted, note in the report that it was unconfirmed, and
  continue.
- If every changed file is on the allowlist from step 1, no changeset is needed — say so and move on. Do not create an empty one.
- Otherwise, run `bun run changeset` — the interactive CLI will prompt for packages and bump type; guide the user to select the affected packages and an appropriate bump type (patch for fixes, minor for features, major for breaking changes).

**If changeset(s) exist:**

- Read each new changeset file and extract the package names listed in its YAML frontmatter (between the `---` fences).
- **Validate every package name** against the actual `name` field in its `package.json`. Run `jq -r .name <workspace>/package.json` for each. A mismatch (e.g. `osn` instead of `@osn/api`, or `@osn/app` instead of `@osn/api`) will cause `changeset version` to fail in CI with "package not in workspace". Fix any mismatches before continuing.
- Compare against the affected workspace packages from step 1.
- Run `scripts/validate-changesets.sh`. It is self-contained — shell and `jq`, no network and no `bun install` — and it fails on exactly the two mistakes CI catches: a package name that is in no workspace, and one changeset mixing an ignored (version-less) package with a versioned one. Its output is the authority; your reading of the frontmatter is the cross-check.
- If any affected package is missing from all changesets, warn the user and offer to run `bun run changeset` to add coverage.

---

## Step 3 — Commit uncommitted changes

Run `git status --porcelain`.

If any uncommitted changes exist, group them into logical commits rather than staging everything at once:

1. Show the full list of changed/untracked files to the user.
2. Analyse the files and propose a grouping into logical commits — e.g. schema changes together, route changes together, frontend changes together, config/tooling separately. Each group should represent one coherent unit of work.
3. Present the proposed groupings and commit messages to the user and ask them to confirm, adjust, or add files to a group.
4. Once confirmed, stage and commit each group in order.

If the user prefers to set the work aside instead, make a WIP commit. Never run bare `git stash`/`git stash pop` — the stash stack is shared with every other worktree of this repo, so a pop can take someone else's work.

If you were told not to commit, or there is no user to confirm a grouping, leave the tree as it is, record the uncommitted files in the report, and continue. Your own report and PR-body files are expected to be uncommitted and are never grouped into a commit.

---

## Step 4 — Build, test, and review test surface

Invoke the `review-tests` skill (`.claude/skills/review-tests/SKILL.md`) as an Agent subagent, passing the list of affected workspace paths as arguments.

**Unless the task says the reviews have already run.** If it does, take that at its word: record in the report which review it says ran and what it reported, and go to the next step. Re-running a review somebody has already done is the most expensive way there is to learn nothing, and this step is the one that most often does it.

Wait for it to complete. If the build fails or any tests fail, record the failures in the report and in `## Test plan`, and continue. If the tooling itself is unavailable — no package manager, no dependencies installed — record every gate as **not run**. That is the honest `## Test plan` entry, and it is never a tick.

If coverage gaps are reported, present them to the user and ask whether they want to address them before continuing.

---

## Step 5 — Check for unrelated changes

Review the changed workspaces list. If changes span multiple clearly unrelated domains (e.g. backend package changes mixed with an unrelated frontend feature, or infra changes bundled with feature work), present the concern to the user:

"These workspaces appear unrelated: [list]. Would you like to isolate any of them into a separate PR before pushing?"

Proceed when the user confirms the scope is intentional or agrees to split the work.

---

## Step 6 — Parallel reviews

**Unless the task says these reviews have already run** — then record what it says they found, note it under `## Decisions`, and go to Step 7.

Otherwise run the following two agents **in parallel** using the Agent tool:

**Agent 1 — Performance review** (general-purpose agent):
Invoke the `review-performance` skill (`.claude/skills/review-performance/SKILL.md`) and execute its instructions, passing the list of affected workspaces and the branch name as context.

**Agent 2 — Security review** (general-purpose agent):
Invoke the `review-security` skill (`.claude/skills/review-security/SKILL.md`) and execute its instructions, passing the list of affected workspaces and the branch name as context.

Wait for both agents to complete. Present both reports to the user in full, using the finding IDs from each review (e.g. S-H1, P-W2) so they can be referenced in the PR description.

Ask the user: "Do you want to address any findings before pushing?" If yes, pause and let the user make changes, then re-run steps 3 and 4 before continuing. With no user, list the findings under `## Decisions` with what you would fix and what you would defer, and continue.

---

## Step 7 — File the findings as issues

Work is tracked in GitHub Issues, not in a markdown checklist. Two repos:

| Kind of item                          | Repo                                |
| ------------------------------------- | ----------------------------------- |
| Review findings — `S-*`, `P-*`, `C-*` | **`xchromo/osn-tracker`** (private) |
| Planned work, features, bugs          | **`xchromo/osn`** (public)          |

`xchromo/osn` is public. A finding names an unpatched route, so filing one there publishes it. **Route by kind, not by severity** — an `S-`, `P-`, or `C-` ID always goes to the tracker, however minor it looks.

Auditing a defect class — when a finding is an instance of a class, enumerate the *shapes* the defect can take rather than re-grepping the first form you found. Recipe and the D1 bind-cap case study: `reference/auditing-defect-classes.md`.

### New findings from Step 6

One issue per finding that this branch does **not** fix. Title leads with the finding ID; body keeps the same four fields the PR uses.

**The issue body must stand on its own.** Someone opening it in six months, with no branch checked out and no wiki open, must be able to see what is wrong, where, and what to do. Name the file and line. State the concrete fix. A body that points at a wiki page instead of saying the thing — "see `wiki/todo/api.md`", "tracked in the TODO" — is not an issue, it is a bookmark, and the page it points at moves or dies. Where a wiki page genuinely adds context, name it by **repo path** (`wiki/systems/rate-limiting.md`) and put the fact in the issue anyway; a `[[wikilink]]` does not resolve on GitHub.

A full worked `gh issue create` — flags, four-field body, closing line — is in `reference/issue-filing-example.md`.

Labels, exactly one of each:

- `area:` — `security` for `S-*`, `performance` for `P-*`, `compliance` for `C-*`
- `severity:` — from the ID prefix per `wiki/conventions/review-findings.md`: `C` → `critical`, `H`/`W` → `high`, `M` → `medium`, `L` → `low`, `I` → `info`
- `product:` — `osn-core`, `pulse`, `cire`, `zap`, `shared`, or `landing`

`--type`, exactly one — an org-level field the Project groups and filters on, separate from the labels:

- **`Bug`** for an `S-*` or `P-*` finding: something behaves wrongly and wants fixing
- **`Task`** for a `C-*` compliance item, and for any finding filed at `severity:info` — it records an observation and asks for no fix

### Findings fixed on this branch

Do not open an issue and close it. Do not edit a checkbox. Put `Closes #N` in the PR body (Step 8) and let the merge close it.

If the finding predates this branch it already has an issue — find it by ID, since the ID leads the title:

```bash
gh issue list --repo xchromo/osn-tracker --search "S-M1 in:title" --state open
```

If a fixed finding turns out to have no issue, open one and close it with a comment naming the PR. **Never delete an issue** — `wiki/conventions/review-findings.md` keeps the history.

### Planned work completed by this branch

Find its issue in the public repo and add it to the `Closes #N` list in Step 8. Same rule: no checkbox edits, no deletions.

```bash
gh issue list --repo xchromo/osn --search "<keywords>" --state open
```

### Up Next

No longer a file to prune. Move the issue's **Status** field in the **OSN Platform** project — `Done` is set by the merge, so the only manual move here is promoting what this branch unblocked. Surface 2–3 candidates to the user and let them decide; do not move anything unasked.

### Docs

**Invoke `obsidian:obsidian-markdown` before writing any page under `wiki/`.** It is the syntax authority for this vault — wikilinks, callouts, embeds, properties, block IDs. Two constraints on top of it, both in the "Writing to the wiki" section of `CLAUDE.md`: edit with **Edit/Write in this worktree** (the Obsidian MCP and the `obsidian` CLI both write to `main`'s tree, so they search and nothing more), and keep anything a GitHub reader needs in tables and mermaid, which render on both surfaces.

Two things to check, both in the same PR as the code:

- **`CLAUDE.md`** — only if this branch adds a pattern, package, convention or architectural decision a future session needs. Reusable context, not noise.
- **The wiki page for every system this branch changes.** A modified system means an updated page; a new one means a new page, linked from at least two existing pages plus the CLAUDE.md navigation table and `wiki/index.md`. `CLAUDE.md` §Wiki maintenance rules holds the frontmatter and linking requirements — follow them there rather than repeating them here.

**Then check the links you just wrote resolve.** `mcp__obsidian-wiki__find_broken_links` indexes `main` and cannot see this branch, so check locally — the `comm -23` recipe is in `reference/wikilink-check.md`.

Commit any doc updates with the message: `docs: update wiki for <branch-summary>`.

Report the issues opened and the issue numbers this branch closes — Step 8 needs both.

---

## Step 8 — Write the PR body

**Do this even when you cannot push.** The body is the deliverable; `gh pr create` is only how it is delivered. Write it to a file whichever way the run ends — no network, no `gh`, failing gates, nothing committed.

Derive the title and body from the branch's commit history (`git log "$BASE"...HEAD --oneline`) and everything that happened during this prep-pr run.

**Title**: short imperative summary of the whole change, under 70 chars.

**Body**: exactly these five sections, in this order. All five are mandatory; a section with nothing in it says "None" rather than being dropped, because an absent section reads as a forgotten one.

The skeleton is already on disk from the top of this file. Fill it in — do not
write a second body beside it.

```markdown
## Summary

<Two or three sentences of prose: what this branch changes and why it was
needed. Not a commit-log restatement — the reviewer can read the commits.
Then bullets for anything the prose could not carry.>

## Workspaces affected

`<pkg>`, `<pkg>`. <Changeset status: which packages it names and at what bump,
or why none is needed.>

## Issues

**Closes**

| Issue | What |
|---|---|
| #<n> | <one-line title> |
| xchromo/osn-tracker#<n> | <finding ID only — e.g. `S-M1`> |

Closes #<n>
Closes xchromo/osn-tracker#<n>

<!-- One plain line per closed issue, under the table and outside it — a table
cell does not trigger GitHub's closing keyword. If this branch closes nothing,
write "This branch closes no issue." and drop the table. -->

**Opened**

| Issue | What |
|---|---|
| xchromo/osn#<n> | <one-line title> |
| xchromo/osn-tracker#<n> | <finding ID only> |

<!-- This PR is public and the tracker is private. A tracker row is the number
and the finding ID and nothing else: no title, no file:line, no word about how
the finding is reached. `xchromo/osn-tracker#412 — S-M1` is the whole entry. -->

## Decisions

### <short title> — `<S-H1 / P-W2 / approach / …>`

- **Issue** — what the problem was.
- **Why** — why it mattered: risk, correctness, or design concern.
- **Solution** — what was done.
- **Rationale** — why this is the right fix, and what was rejected.

### <next decision> — `<ID or "approach">`

…

**Out of scope** — <what was found and deliberately not fixed here, each with
the issue number now tracking it. One line each. If there is nothing, the line
is "**Out of scope** — None." — never a missing subsection.>

## Test plan

| Gate | Command | Result |
|---|---|---|
| Type check | `bun run check` | <what happened, or `not run — <reason>`> |
| Tests | `bun test <scope>` | <`<n> pass`, a failure, or `not run — <reason>`> |
| … | … | … |

<Then anything a reviewer must exercise by hand, and anything that stayed
unverified — say so plainly rather than leaving it implied.>
```

**Every row is filled in from a command you ran in this worktree, in this run.**
The Result column takes what the command actually printed. A gate you did not
run is written `not run` with the reason — no package manager, no network, no
dependencies — and a run where nothing could execute is a table of `not run`
rows, which is a correct and complete test plan. Never write a tick, a "passes",
or a pass count you did not watch appear: an invented green gate is the one
failure in this document a reviewer cannot detect.

### Section rules

**Issues.** One row per issue. **"Opened" means issues raised *against this
branch* — findings from its own review, or work this branch deliberately split
out.** An issue found while auditing something else, in another package, or in
a file this branch never touches does not belong in the table however it was
discovered: listing it implies a relationship the PR does not have, and a
reviewer then has to work out which rows are actually theirs. Mention a
cross-package audit in one line of prose under **Out of scope** and let the
tracker hold the results. The plain `Closes` lines under the table are what actually close anything — the template shows where they go. Cross-repo (`Closes xchromo/osn-tracker#<n>`) works with write access to both, but verify it closed after the merge and close it by hand if not.

**A PR on `xchromo/osn` is public.** Reference a tracker issue by number and finding ID only — never paste its title, its file:line, or a word of its body. `xchromo/osn-tracker#412 — S-M1` is the whole entry.

**Decisions.** One `###` heading per decision, so each gets its own anchor and shows up in GitHub's outline. The heading is a plain-English title; the ID goes after the em dash, in backticks, and is omitted for a decision that has no finding behind it. The four fields are mandatory and always in the same order — a reviewer scanning ten PRs reads them positionally.

What belongs here: every non-trivial design choice, every finding fixed on this branch, and every finding **dismissed** rather than fixed — dismissals carry their reasoning in **Rationale**. What does not: routine lint fixes, formatting, and anything the diff already says plainly.

**Out of scope** is a subsection of Decisions, not a section of its own. It exists so a reviewer never has to ask "did you notice X?" — one line per thing noticed and left, each naming the issue now tracking it.

**Test plan.** The table is the gates that ran, with their real results. Never write a gate as passing without running it in this worktree. Anything not covered by an automatic gate goes below the table in prose, including the honest negatives — "the two-app ceremony is not exercised anywhere" belongs in the PR, not in a comment nobody reads.

### Check the body before you finish

```bash
grep -c '^## \(Summary\|Workspaces affected\|Issues\|Decisions\|Test plan\)$' <body-file>
grep -c '^## ' <body-file>
```

Both must print `5`. A first count under 5 means a section is missing, renamed, or demoted to `###`. A second count above 5 means you added a top-level section of your own — the most common one is a place to park notes about gates that could not run, and those belong in the report file instead. Custom top-level headings are not allowed: a change-specific title goes in the PR title and in `## Summary`, never as a `##` of its own.

---

## Step 9 — Push and open the PR

Run `git push -u origin HEAD`, then open the PR **against `$BASE` from Step 0**, not against `main`:

```bash
gh pr create --base "$BASE" --title "<title>" --body-file <path>
```

`gh pr create` also reads `branch.<current>.gh-merge-base` on its own, so `--base` is belt and braces — pass it anyway, because a branch created without that config silently targets `main`.

Pass `--body-file`, never `--body`: a heredoc inside `--body` mangles backticks and `$` in the prose.

With no network or no `gh`, record that the PR was not opened, name the base it should target, and leave the body file in place. That is a complete run.

### After opening

Confirm the base actually took:

```bash
gh pr list --repo xchromo/osn --state open --json number,headRefName,baseRefName
```

A stacked PR showing `main` in `baseRefName` is not stacked — fix it with `gh pr edit <n> --base <parent-branch>` rather than in the web UI.

### Register the stack

Only when `$BASE` is not `main`. A correct base gives a correct diff; it does not make GitHub render a stack, which is a separate object.

```bash
gh stack link <bottom-pr> [<middle-pr> …] <this-pr>   # bottom to top
gh stack checkout <stack-number>                       # confirm
```

Why `checkout` and not `view` confirms it, and what to do with no network: `reference/registering-a-stack.md`.

Report the PR number, its base branch, whether the stack is registered, and the issues it closes.
