# GitHub Issues Migration — Design

**Date:** 2026-08-15
**Status:** Approved (design), pending implementation
**Branch:** `chore/github-issues-migration`

## Problem

All tracked work lives in two markdown checklists: `wiki/TODO.md` (411 open items, 1034 lines) and `cire/wiki/todo/*.md` (139 open items across 10 shards). Both are edited by hand and by the `prep-pr` command. This costs us:

- **Merge collisions.** Every feature PR touches the same TODO file. The cire shards exist only to work around this.
- **No query.** "What P0 security work is open in Pulse?" needs a grep and a read, not a filter.
- **No link to code.** An item cannot reference the PR that fixed it, and a PR cannot close an item.
- **No status beyond a checkbox.** In-progress, blocked, and in-review are all `[ ]`.

Move to GitHub Issues + one org-level Project, keep the narrative wiki, and rewrite the commands that write to TODO.

## Constraints

### Disclosure

`xchromo/osn` is a **public** repo. The security, performance, and compliance backlogs carry 344 open findings with file:line references, exploitability notes, and named unpatched routes. Publishing them is publishing an attack map. This forces the two-repo split below.

Business and monetisation content (`wiki/business/`, gitignored) never enters an issue, public or private.

### Never delete a finding

`wiki/conventions/review-findings.md` states: "**Never delete** findings from the backlog — the history matters." Carried forward as: **close the issue, never delete it.** Closed issues keep the full body, the fix commit, and the discussion. Deleting an issue is out of bounds for every script and command in this design.

### API limits (verified 2026-08-15)

| Limit | Value | Binding? |
|---|---|---|
| Items per Project v2 | 50,000 | No |
| Fields per Project | 50 | No |
| Sub-issues per parent | 100 | No (largest epic ≈ 97) |
| Sub-issue nesting depth | 8 | No (we use 2) |
| Primary rate limit | 5,000 req/hr | No |
| **Secondary: content creation** | **80/min, 500/hr** | **Yes** |

~570 issue creates plus ~550 sub-issue links ≈ 1,120 mutations ≈ three hourly windows at a self-imposed 450/hr with an 8s throttle. Project membership costs **zero** API calls — the Project's built-in auto-add workflow pulls new issues in, saving ~570 `addProjectV2ItemById` mutations.

### Token scopes

`gh auth status` shows `repo`, `read:org`, `gist`. Projects need more:

```bash
gh auth refresh -h github.com -s project -s read:project
```

Verified gap — `gh project list --owner xchromo` currently fails with `your authentication token is missing required scopes [read:project]`. Issues, labels, and sub-issues all work on the existing `repo` scope, so **only Phase 0 is blocked** on this.

## Design

### Two repos

Rule: **review findings → private tracker; planned work → public repo.**

| | Repo | Content | Open |
|---|---|---|---|
| Public | `xchromo/osn` | Up Next, per-app sections, Zap, Verified Identity, Platform, Auth Improvements, Future; cire status/web/api/db/import/platform | **206** |
| Private (new) | `xchromo/osn-tracker` | Security, Performance, Compliance backlogs — both osn and cire | **344** |

Plus ~20 epic parents → **~570 issues**.

The performance backlog goes private with security and compliance. Perf findings here describe unbounded queries, missing pagination, and unthrottled endpoints — on a public repo they read as a DoS shopping list. One rule ("findings are private") also keeps `prep-pr` routing by *kind*, not by a severity judgment call it would get wrong.

Auth Improvements (Copenhagen Book) stays **public**: its three open items are roadmap hardening — JWKS migration for `@zap/api`, 8-digit registration OTP, device/session listing UI — not open vulnerabilities.

### One org Project

A single **private** org-level Project on `xchromo`, named **OSN Platform**.

- Org-level because only org projects can span two repositories.
- Private so tracker issue titles do not leak through the project view.

Custom fields (3 of 50):

| Field | Type | Values |
|---|---|---|
| Status | single-select | Backlog, Up Next, In Progress, In Review, Blocked, Done |
| Priority | single-select | P0, P1, P2, P3 |
| Effort | single-select | XS, S, M, L, XL |

No `Finding ID` field. Populating one for 344 migrated findings costs 344 extra GraphQL mutations, and the ID already leads the issue title (`S-M34 — …`), so `gh issue list --search "S-M34"` finds it. An unpopulated field is worse than no field.

Views:

1. **Board** — by Status
2. **Table** — grouped by Labels (product is a label, not a field)
3. **Review findings** — filtered to `area:security,performance,compliance`, grouped by Labels
4. **Up Next** — Status = Up Next / In Progress, Priority P0–P1

Two built-in workflows carry the rest, both costing zero API calls:

- **Auto-add** on both repos, so every new issue lands in the project.
- **Item added to project** sets `Status` = `Backlog`. The migration script never touches project fields. The ~10 Up Next items get their Status and Priority set by hand in the UI during Phase 1 — the only hand-curation in the migration.

### Labels (identical on both repos)

- `product:` `osn-core`, `pulse`, `cire`, `zap`, `shared`, `landing`
- `area:` `feature`, `security`, `performance`, `compliance`, `ops`, `docs`, `schema`
- `severity:` `critical`, `high`, `medium`, `low`, `info`
- `epic`

Product / area / severity are **labels, not project fields**, so `gh issue list --label severity:critical` works without the project scope. Status / Priority / Effort are project fields because they are workflow state, not classification. Exactly one `product:` label per issue, so grouping the table view by Labels gives clean columns.

Severity derives from the finding-ID prefix per `wiki/conventions/review-findings.md`: `C` → critical, `H`/`W` → high, `M` → medium, `L` → low, `I` → info.

### Epics and sub-issues

Each `##` section becomes an **epic** issue labelled `epic`; each `- [ ]` item under it becomes a **sub-issue**. Two levels only — nested bullets and continuation paragraphs stay in the sub-issue body rather than becoming a third level.

Largest epic is Security Backlog at 97 items, under the 100-sub-issue cap. If a section later exceeds 100, split by the `###` severity sub-heading.

### Migration script

`scripts/todo-to-issues/` — bun, committed to the repo, idempotent. Split by responsibility (`parse`, `classify`, `wikilinks`, `render`, `assert`, `github`, `main`) so everything upstream of the writer is pure and unit-tested; `github.ts` is the only module that talks to the network.

1. **Parse.** Walk `wiki/TODO.md` and `cire/wiki/todo/*.md`. For each `- [ ]`, capture the item text plus every nested bullet and continuation paragraph until the next sibling. Item prose is dense and multi-paragraph; it carries over **verbatim**.
2. **Classify.** Repo, labels, Finding ID, and severity from the item text and its `##` / `###` ancestors.
3. **Rewrite links.** `[[wikilink]]` → a repo-relative markdown link, resolved by scanning `wiki/` filenames. Unresolved links become plain code spans rather than dead links.
4. **Dry run first.** Emit a JSONL manifest of every issue that would be created — title, body, repo, labels, parent — and review it before any write.
5. **Create.** Epics first, then sub-issues, then the parent links. Throttle 8s between mutations.
6. **Resume.** `.migration/manifest.json` maps issue number ↔ source file + line, so a re-run skips what exists. A crash mid-window costs nothing.

Completed `[x]` items (233 in osn) do **not** become issues. They fold into the existing `wiki/changelog/{completed-features,security-fixes,performance-fixes,compliance-fixes}.md`. Creating 233 born-closed issues would double the migration for no query value — the changelog already serves the history.

## Phasing

Incomplete work first, backlog second — per the original ask.

| Phase | Work | Issues |
|---|---|---|
| **0** | Token refresh (user); create `osn-tracker`; labels on both repos; project + fields + views + auto-add | 0 |
| **1** | **In-flight**: Up Next 10, Pulse 11, OSN Core 12, Cire 2, Cire Landing 7, Landing 3, cire shards 32 | **77** |
| **2** | Planned, not started: Zap 39, Verified Identity 38, Platform 38, Auth 3, Future 11 | **129** |
| **3** | Backlogs → private tracker: Security 97+35, Performance 76+72, Compliance 64 | **344** |
| **4** | Docs: fold `[x]` into `wiki/changelog/`, delete TODO checklists, leave pointer pages | 0 |
| **5** | Rewrite `prep-pr.md` + `new-feat.md`; add `.github/ISSUE_TEMPLATE/` | 0 |

Phase 0 is the only phase blocked on the user. Phases 1–3 are the script; 4–5 are edits.

## Command rewrites

### `prep-pr.md` — Step 7 replaced

Today Step 7 writes `S-*`/`P-*` findings into `wiki/TODO.md`, checks off completed items, and prunes Up Next. After migration:

- New `S-*` / `P-*` / `C-*` findings → `gh issue create --repo xchromo/osn-tracker` with the severity, area, and product labels, and the finding ID leading the title. Body keeps the existing four-field format (Issue / Why / Solution / Rationale) unchanged.
- Findings **fixed on this branch** → `Closes #N` in the PR body. Never edit a checkbox; never delete an issue.
- Step 8's PR body gains a mandatory `## Issues` section listing every `Closes #N` and every issue opened.
- "Up Next pruning" becomes a Project Status move, not a file edit.
- **Narrative wiki is untouched.** `wiki/systems/`, `wiki/runbooks/`, `wiki/compliance/`, and `wiki/conventions/` keep being updated by hand as they are today. Only the checklists leave.

### `new-feat.md` — issue-first

Gains a step before the worktree: create the issue, or take an existing one by number. Branch name derives from the issue (`feat/<issue-slug>`), and the Project Status moves to In Progress. The worktree/branch flow (Agent 1A and 1B) is otherwise unchanged.

### Issue templates

`.github/ISSUE_TEMPLATE/` gets three forms: **feature**, **review finding** (the four-field format, with a Finding ID input), and **bug**.

## Out of scope

- `docs/superpowers/plans/` — 14 plan documents with checkboxes. These are specs, not backlog. They stay as files.
- Migrating closed/`[x]` history as issues (see above).
- Any change to the narrative wiki beyond deleting checklists and leaving pointers.
- GitHub Actions automation to sync issues back to markdown — the markdown is going away, not being mirrored.

## Testing

Two layers. The pure modules (parse, classify, wikilinks, render, assert, and the throttle) carry unit tests run by `bun run test:migration`. On top of that the manifest is the artifact under review, and `bun run migrate:verify` refuses to apply unless every gate below passes —

- Manifest issue count matches the grep counts in this document (206 public, 344 private, ~20 epics).
- Zero items classified into the public repo carry a `severity:` label.
- Zero manifest bodies match the business-content patterns (ABN, entity name, pricing).
- Every `[[wikilink]]` either resolved to a path that exists or degraded to a code span — no `[[` survives.
- Spot-check five multi-paragraph items for verbatim body carry-over.

After the run, `gh issue list --repo xchromo/osn --limit 500 | wc -l` reconciles against the manifest.

## Rollback

The TODO files are not deleted until Phase 4, after Phases 1–3 have run and reconciled. If the migration is abandoned mid-flight, the markdown is still authoritative and the created issues can be closed in bulk — never deleted.
