Analyse the current branch diff for performance concerns. $ARGUMENTS may contain a list of changed workspaces and a branch name; if not provided, derive them from `git diff --name-only main...HEAD`.

Read all changed source files in the affected workspaces and examine them for the following issues:

---

## Backend (packages/api, packages/db)

- **N+1 queries** — loops that issue DB calls inside iterations instead of batching with `inArray` or a join
- **Missing indexes** — columns used in `WHERE`/`JOIN` in Drizzle queries that have no corresponding index in the schema
- **Unbounded queries** — list endpoints without `LIMIT` / pagination
- **Blocking operations in Effect pipelines** — synchronous CPU-heavy work not wrapped in `Effect.sync` / `Effect.promise`, or `yield*` chains that could be parallelised with `Effect.all`
- **Large serialised payloads** — JSON responses that include unnecessary nested data or could be streamed
- **WebSocket fan-out** — message broadcasting that iterates all connections in O(n) without grouping or batching

## Frontend (apps/pulse, apps/landing)

- **Unnecessary SolidJS re-renders** — signals read outside of JSX or tracked contexts (defeating fine-grained reactivity), or `createEffect` with broad dependencies
- **Heavy bundle imports** — importing entire libraries (`import * as _`) where tree-shaking would suffice; or missing dynamic `import()` for large code paths
- **Missing lazy-loading** — route components not wrapped in `lazy()` in SolidJS router
- **Unthrottled event handlers** — scroll, resize, or rapid input handlers without `throttle`/`debounce`

## Build & CI

- **Turbo cache misses** — overly broad `outputs` globs or missing `inputs` declarations in `turbo.json` tasks that cause unnecessary re-runs
- **Redundant build steps** — tasks that duplicate work already handled by a dependent task in the pipeline

---

Report findings as a prioritised list using these labels:

- **Critical** — will cause measurable degradation in production (e.g. unbounded query on hot path)
- **Warning** — likely to cause issues under load or as the codebase grows
- **Info** — minor inefficiency or best-practice suggestion

If no concerns are found, state that explicitly: "No performance concerns found."
