---
name: review-performance
description: Use when reviewing a branch diff for performance defects — redundant database round trips, N+1 queries, unbounded reads, per-request layer rebuilds, wasted client fetches, and build steps that ship a broken artefact — and reporting findings with P-C/W/I IDs in the four-field format.
---

Review the current branch diff for performance defects.

`$ARGUMENTS` may name the changed workspaces and the branch. Whether or not it does, start from the diff.

## Step 0 — Write the report skeleton before you review anything

Do this before the diff, before reading a line of source. The file is the
deliverable: a run that leaves a differently-shaped file has produced nothing,
however good the analysis inside it. Writing the shape now means the rest of the
run only fills it in. Leaving it until the end is how a section goes missing.

Copy this verbatim. The report file is `PERFORMANCE-REVIEW.md` unless the task
named another:

```bash
cat > PERFORMANCE-REVIEW.md <<'EOF'
## Performance findings

None

## Measurements

None

## Coverage

None

## Sections checked

None
EOF
```

Those four `##` headings are the whole permitted set, and that is their order.
Replace a `None` as you fill its section in; leave it where the section really
is empty. Never add a fifth `##`. The ones that get invented are `## Summary`,
`## Verified strengths`, `## Scope and method`, `## Verdict` and `## Bottom
line`, and none of them is allowed: a summary sentence goes at the top of
`## Performance findings`, a number you counted goes in `## Measurements`, and
an environment caveat goes at the end of `## Sections checked`.

What each section holds is under **Report shape** at the end of this file.

## Step 1 — Route the diff

Resolve the base branch first. A stacked branch does not merge into `main`, and diffing against `main` reports the parent branch's files as this branch's:

```bash
BASE=$(git config --get branch.$(git branch --show-current).gh-merge-base || echo main)
git diff --name-only "$BASE"...HEAD
```

Keep that file list. Every file on it gets a verdict in the report, including the ones you clear.

Now grep the diff for the strings below. **A hit makes the named section mandatory**: you work every bullet in that section against **the whole changed file the hit landed in**, not against the matched line, and you record the verdict under `## Sections checked`. A section nothing matched is optional.

Routing widens attention; it never narrows it. **A grep hit is a reason to open a section, never a reason to stop reading.** Some patterns fire on ordinary code — `.get()` on a `Map`, `for (` on a loop over three constants. When every hit in a section is that kind, write one line under `## Sections checked` naming what matched and why the section does not apply, then move on. Never satisfy a bullet with code that is not in the diff.

```bash
git diff "$BASE"...HEAD | grep -nE '<pattern>'
```

| Grep the diff for | Sections that become mandatory |
|---|---|
| `await db.`, `.get()`, `.all()`, `.select(`, `drizzle`, two `await`s in a row in one function | Database round trips |
| `for (`, `.map(async`, `forEach`, `await` inside a loop body | Database round trips, Loops and batching |
| `.where(`, `eq(`, `inArray(`, a new column read in a predicate | Database round trips, Indexes |
| a route file, `.get(`, `.post(`, `derive(`, `resolve(`, middleware, a role or entitlement gate | Database round trips, Shared middleware |
| `Effect.provide`, `runPromise`, `Layer.`, `ManagedRuntime` | Effect runtime |
| `fetch(`, `createResource`, `createEffect`, `createMemo`, `onMount` | Client fetches, SolidJS reactivity |
| `import * as`, a new dependency in a `package.json`, a route component | Bundle and loading |
| `scroll`, `resize`, `oninput`, `onInput`, `ResizeObserver`, `scrollHeight`, `getBoundingClientRect` | Layout and event handlers |
| `build`, `astro.config`, `wrangler.toml`, `turbo.json`, a `scripts/` file, a workflow under `.github/` | Build and deploy |
| `.changeset/` | Changesets |

## Step 2 — Work the mandatory sections

Read every changed source file in full, then take each mandatory section one bullet at a time. A bullet names a property the code is supposed to have: find the code that would carry that property, and check whether it does. A bullet you cannot tie to any line of the diff is cleared. A bullet whose code you found and whose property is missing is a finding — write it up before moving to the next bullet, or you will lose it.

**Count before you write, and write the count down first.** A performance
finding is an argument about cost, so establish the cost before you argue.
Before drafting a finding, go to the code and count the thing that is actually
charged for — statements issued on the request, rows read, bytes added to a
bundle, times a component re-renders — with the number as it stands and the
number after your fix. Put that pair in `## Measurements` **in the same moment
you count it**, not at the end of the run: a `## Measurements` section filled in
afterwards from memory is a section of estimates, and it reads as one. The
finding's `Why` then quotes the count rather than restating that something is
slow. Where you genuinely cannot count — a bundle size with no build to run — say
what you estimated and from what, on its own line in the same section.

**A cost that is paid needlessly is a finding.** Do not wait for a benchmark to prove it. Rate it `P-I` if the path is cold or the saving is small; do not omit it.

**A saving in one place that adds cost in another is not a saving.** Every optimisation on shared code — middleware, a gate, a helper a dozen files import — is judged by what it does to the callers that did not ask for it. Check them.

**A comment is a claim, not a control.** A block explaining that a value is
cached, batched, indexed or hoisted is the author's intent; the statement count
is what the database charges for. Check the code does what the comment says, and
never report the comment itself as the defect — a `TODO` beside correct code is
not a performance finding.

---

## Database round trips

The dominant defect class in this repo. D1 is a network hop per statement, so the count of statements is the cost.

### Two `await`s in a row: the diagnosis, then the fix

Almost every finding in this section starts as a pair of sequential statements.
The pair is one defect with two possible fixes, and picking between them is a
two-question decision. Answer them in this order — the second question is
meaningless until the first is settled.

**Question 1 — does the second statement have to wait?** It has to wait only if
the key it is issued on was *produced* by the first. Trace that key back to
where it was bound, in the code, not by eye:

- Bound before the first query ran — the function's own argument, a path
  parameter, a field of the request body — then **it does not have to wait**,
  however it is spelled at the call site. `getListing(id)` that awaits a row
  and then calls `fetchCategories(row.id)` is the classic disguise: `row.id`
  and `id` are the same value, the second query never needed the first, and the
  code only looks sequenced. This is a finding.
- Genuinely produced by the first — a foreign key the first row carried and
  nothing else knew — then the sequence is real and is not a finding on its own.
  Move to the unbounded-read and repeated-read bullets instead.

**Question 2 — can one statement answer both?** Only once the pair is
established as needlessly sequential:

- **It can, so fold.** The second query's rows are reachable from the first
  query's own `FROM`/`JOIN` — the same row, or a table keyed on it. The fix is
  an `EXISTS (…)` or a joined column on the earlier query's select, so the
  request drops a statement rather than overlapping two. `cire/api/src/services/directory.ts`
  already does this with its `inWedding` column; copy that idiom rather than
  inventing one. Prefer this whenever it is available: D1 charges per statement,
  so a fold removes cost where running in parallel only hides it. Not a cache,
  not a memo, not `Promise.all` — each of those still issues both statements.
- **It cannot, so run them together.** The two touch unrelated tables, or
  different stores, or the second's shape is not something a join to the first
  would serve. `Promise.all`, `Effect.all` (with `concurrency: "unbounded"`), or
  a `db.batch`. Statement count is unchanged and the latency of one hop is
  removed instead of two.

Say in `Rationale` which of the two you picked and why the other does not
apply. A finding that names the pair but leaves the fix as "parallelise or
combine these" has not made the decision the reader needed.

### The rest of the section

- **The same rows read twice in one request.** A collection scanned once to validate and again to derive a value.
- **Rows read whose value cannot change the outcome.** A cap check that fetches every row when the input is already under the floor; a ceiling derived from every row when only two of them can raise it.
- **A result the caller already holds, fetched again.** A create or claim handler returns the record it wrote, and the next screen fetches it by ID.

## Loops and batching

- **N+1** — a DB call inside an iteration. Batch with `inArray`, a join, or a single `IN` statement.
- **Sequential awaits over an array** — `for (const x of xs) await f(x)` where the calls are independent. `Promise.all`/`Effect.all`.
- **Work repeated per iteration that is constant across it** — a config read, a key parse, a regex compile hoisted out of the loop.

## Indexes

- A column used in a `WHERE`, `JOIN` or `ORDER BY` with no matching index in the schema package.
- A composite predicate whose index exists but in the wrong column order to serve it.
- A uniqueness or existence probe that a partial unique index would serve — say so, and say which index.

## Unbounded reads

- A list endpoint with no `LIMIT` and no pagination.
- A count over a table that grows without bound where an indexed existence probe would do.
- A response that serialises nested data no caller reads.

## Shared middleware

- A fetch added unconditionally to a gate that a dozen routes mount, where most of them do not need it. That is a repo-wide regression dressed as an optimisation. The fix is an optional parameter: a route that does not ask for the extra data runs exactly the query it always ran.
- A middleware that resolves the same record every route behind it then resolves again.
- **This bullet also applies to a fix you propose.** Before writing a `Solution` that adds a column, a join or a fetch to shared code — a gate, a middleware, a helper a dozen files import — count the callers that do not need it (`grep -rn '<gateName>(' <workspace>/src`) and say in `Rationale` what they now pay. If the answer is anything but "nothing", the Solution is not finished: make the extra work an **optional parameter**, and state that a caller passing none runs exactly the query it ran before. A fix that taxes the callers that did not ask for it is a new finding, not a fix.

## Effect runtime

- `Effect.provide(SomeLive)` inside a per-request `runPromise`. That rebuilds the layer graph on every call — a new DB connection and an OpenTelemetry SDK restart per request. The layer graph is built once at boot and threaded through route factories. See `wiki/architecture/backend-patterns.md`.
- A `yield*` chain of independent effects that `Effect.all` would run together.
- CPU-heavy synchronous work inside an effect without `Effect.sync`.

## Client fetches

- Data fetched again after a full document navigation (`window.location.href = …`) that the previous screen already had. Hand it across the gap deliberately, validate it before trusting it, and fall through to the normal fetch on any failure.
- A `createResource` that refetches on a signal change that does not affect its result.
- Waterfalled requests — a fetch that only starts once an unrelated one resolves.

## SolidJS reactivity

- A signal read outside JSX or a tracked scope, which defeats fine-grained reactivity and re-runs the whole component.
- A `createEffect` whose dependencies are broader than what it uses.
- A derived value recomputed on every read where `createMemo` would compute it once.

## Bundle and loading

- `import * as x` from a library where named imports would tree-shake.
- A route component not wrapped in `lazy()`.
- A heavy dependency pulled into a path that rarely needs it, where a dynamic `import()` would defer it.
- First-party static assets — fonts, images, generated CSS — served with no cache headers.

## Layout and event handlers

- `scroll`, `resize` or rapid input handlers with no throttle or debounce.
- A read of `scrollHeight`, `offsetHeight` or `getBoundingClientRect` interleaved with a style write in the same frame — that forces synchronous layout every time. Batch the reads before the writes.
- An observer registered per item where one on the container would do.

## Build and deploy

- **A build step that fails and still exits 0.** Check every layer that could swallow the error: a provider constructed with `throwOnError: false`, a retry that logs and continues, a warning where a throw belongs. If the deploy step runs straight after the build with no gate between them, a swallowed failure ships.
- A build guard that lives only in CI, where it cannot fire locally or on a by-hand deploy. It belongs at the end of the package's own `build` script.
- `turbo.json` tasks with `outputs` globs broader than the real output, or missing `inputs`, causing cache misses.
- A task that repeats work a dependency already did.

## Changesets

- An **empty changeset** is correct when the branch touches only the allowlisted paths in `scripts/changeset-required.sh` (`.claude/`, `.github/`, `scripts/`, `wiki/`, `docs/`, top-level prose). Do not flag it.
- A changeset is only a finding here when workspace source changed and none names the changed package. Anything more than that belongs to `prep-pr`, not this review.

---

## Finding format

IDs are `P-C1`, `P-C2`, … Critical; `P-W1`, … Warning; `P-I1`, … Info. The counter increments within each tier across the whole report, so a finding can be referred to unambiguously.

Each finding uses exactly this structure:

```
**P-W1** — <short title>
**Issue:** What the problem is, with the file and line.
**Why:** The failure mode, the scale at which it bites, and what it costs — a count of round trips, a bundle size, a re-render count. Not "this is slow".
**Solution:** The concrete change.
**Rationale:** Why that change removes the cost without adding one elsewhere.
```

Tiers:

- **Critical (P-C)** — measurable degradation in production now: an unbounded read on a hot path, a per-request layer rebuild, a broken artefact that ships.
- **Warning (P-W)** — bites under load or as data grows: a redundant round trip, an N+1 on a list that is short today.
- **Info (P-I)** — a real but small waste, or a best-practice gap.

If a section is clear, say so. If the whole review is clear, write "No performance concerns found." — and still fill in `## Coverage` and `## Sections checked`.

## Report shape

The file already exists — Step 0 wrote it, with the four sections in order.
Keep that. This section says what goes in each one.

`## Performance findings` holds the findings, in the format above, most severe
first, with a summary sentence at the top if you want one.

`## Measurements` names anything you counted rather than guessed — statements per request before and after, rows read, bytes added to a bundle. A finding whose `Why` claims a cost that appears nowhere here is an estimate, and should say so.

`## Coverage` lists **every file** from the Step 1 diff, one line each, with a verdict — a finding ID, or `clear`, or `not source` (lockfiles, generated output, fixtures). A file you did not open is not clear; say you did not open it and why.

`## Sections checked` lists each section Step 1 made mandatory, and under it each bullet in that section, the code you looked at, and the verdict. This is the part that catches a skim: a bullet with no file and no line beside it was not checked.

### Check the file before you finish

Run these two counts on the file you just wrote:

```bash
grep -c '^## \(Performance findings\|Measurements\|Coverage\|Sections checked\)$' <report-file>
grep -c '^## ' <report-file>
```

Both must print `4`. A first count under 4 means a section was renamed,
demoted to `###`, or overwritten while you were filling it in. A second count above 4 means you added a
top-level section of your own — the usual ones are `## Summary`, `## Verified
strengths`, `## Scope and method`, `## Verdict` and `## Bottom line`. None of
those is allowed as a `##`. A summary sentence goes at the top of `## Performance
findings`; a number you counted goes in `## Measurements`; an environment caveat
goes at the end of `## Sections checked`.

