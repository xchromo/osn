# Audit this monorepo's dependencies

You are in a checkout of the repository, on `main`. Audit its dependencies: whether the workspaces agree with each other about what they depend on, and whether anything is behind what is published.

## Environment

- There is no network. The npm registry is unreachable, `WebFetch` will fail, and so will `git fetch` and every `gh` command. That is by design; do not treat it as a defect.
- Package tooling is not installed and there is no `node_modules`. `bun install`, `bun outdated` and `bun run check` cannot run. Read the files on disk instead.
- Do not modify any `package.json` or the lockfile, and do not commit anything. Report; don't fix.

## Deliverable

Write your report to `DEPS-REVIEW.md` at the root of the repository. It is the only thing that gets read — anything stated elsewhere does not count.
