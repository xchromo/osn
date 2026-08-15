---
title: GitHub Issues setup (repos, labels, Project)
tags: [runbooks, process, issues]
related:
  - "[[review-findings]]"
  - "[[index]]"
last-reviewed: 2026-08-15
---

# GitHub Issues setup

One-off setup for the move off `wiki/TODO.md`. Written down so it can be redone
— on a fork, after an org rename, or when a label set drifts.

Two repos and one Project:

| Thing | What it holds |
|---|---|
| `xchromo/osn` (public) | Feature work, bugs, ops, docs, schema |
| `xchromo/osn-tracker` (private) | Every security, performance and compliance finding |
| `OSN Platform` (org Project, **private**) | Both repos' issues in one board |

Findings are split off because `xchromo/osn` is public and an open finding is a
disclosure. See `[[review-findings]]` for what may be said in a public issue
about a finding that exists (the ID, nothing else).

## 1. Token scopes

```bash
gh auth status
```

`project` and `read:project` are not in the default `gh` scope set. Without
them every `gh project` command fails with
`your authentication token is missing required scopes`.

```bash
gh auth refresh -h github.com -s project -s read:project
gh project list --owner xchromo   # must not error
```

## 2. Private tracker repo

```bash
gh repo create xchromo/osn-tracker --private \
  --description "Private tracker for OSN security, performance and compliance findings"
```

The issue form for findings lives at `.github/tracker/ISSUE_TEMPLATE/` in this
repo and is copied across on first setup — it is kept here so it is reviewed
with everything else, but GitHub only reads a form from the repo it serves.

```bash
gh api repos/xchromo/osn-tracker/contents/.github/ISSUE_TEMPLATE/review-finding.yml \
  -X PUT -f message="chore: add the review-finding form" \
  -f content="$(base64 -i .github/tracker/ISSUE_TEMPLATE/review-finding.yml)"
```

## 3. Labels

```bash
./scripts/todo-to-issues/labels.sh
```

19 labels per repo: 6 `product:`, 7 `area:`, 5 `severity:`, and `epic`. The
script uses `--force`, so re-running it is how a colour or description is
changed. Every issue carries exactly one `product:` and one `area:`; only a
finding carries a `severity:`, taken from the tier letter in its ID. The
manifest gate in `scripts/todo-to-issues/assert.ts` rejects anything else.

## 4. The Project

```bash
gh project create --owner xchromo --title "OSN Platform"
gh project list --owner xchromo   # note the number, $N below
```

> **An org Project is created public.** Make it private in the UI
> (Settings → Visibility → Private) **before** a single tracker issue is added.
> A public Project lists the titles of every issue in it, including the private
> ones — which is the whole disclosure the tracker repo exists to prevent.

```bash
gh project field-create $N --owner xchromo --name "Status" \
  --data-type SINGLE_SELECT --single-select-options "Backlog,Up Next,In Progress,In Review,Blocked,Done"
gh project field-create $N --owner xchromo --name "Priority" \
  --data-type SINGLE_SELECT --single-select-options "P0,P1,P2,P3"
gh project field-create $N --owner xchromo --name "Effort" \
  --data-type SINGLE_SELECT --single-select-options "XS,S,M,L,XL"
```

## 5. Workflows (UI only — no API)

Project → Workflows:

1. **Auto-add to project** — enable once per repo, filter `is:issue is:open`,
   for `xchromo/osn` and `xchromo/osn-tracker`.
2. **Item added to project** — set `Status` = `Backlog`.

Do this **before** the migration runs if you can. Auto-add is what makes the
migration cost zero Project API calls.

**It did not happen that way on the first run.** Creating the Project needs the
`project` scope, and `gh auth refresh` cannot be run by an agent — it is
interactive. Rather than stall the whole migration on one token grant, the
issues were created first and the Project comes second. Auto-add only fires on
issues opened *after* the workflow is enabled, so everything created before it
has to be backfilled:

```bash
bun run scripts/todo-to-issues/backfill-project.ts $N          # dry run, prints the plan
bun run scripts/todo-to-issues/backfill-project.ts $N --apply
```

It reads `.migration/created.json`, skips anything already on the board, and
throttles at the same 8s gap the issue creation uses — an item-add is a
content-creation mutation and counts against the same 500/hour.

## 6. Views (UI only)

| View | Layout | Setting |
|---|---|---|
| Board | Board | Group by Status |
| By product | Table | Group by Labels |
| Review findings | Table | Filter `label:area:security,area:performance,area:compliance`, group by Labels |
| Up Next | Board | Filter `status:"Up Next","In Progress"` |

## 7. Record the numbers

Fill these in once, here:

- Project number: `TBD — fill at setup`
- Tracker repo: <https://github.com/xchromo/osn-tracker>

## Rate limits worth knowing

The primary limit (5,000 REST requests/hour) is not the one that bites. The
secondary content-creation limit is: **80 creations per minute and 500 per
hour**, counted across issues, comments and sub-issue links together. The
migration writer self-throttles to 450/hour with an 8s gap. Exceeding it earns
a 403 with a `Retry-After`, and repeatedly ignoring that earns a longer block.

Other ceilings, none of them close: 50,000 items per Project, 100 sub-issues
per parent, 8 levels of sub-issue nesting.
