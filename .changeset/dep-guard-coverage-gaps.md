---
"@tools/oxlint-house": patch
---

Close the gaps in the guards around the dependency and vendored-plugin surface. No rule changes; this is the wiring that decides whether the guards run at all.

- `scripts/verify-vendored-anti-slop-pin.sh` (new, wired into CI on pull requests) fails a change to `tools/oxlint/anti-slop` that does not move the pinned upstream commit in that directory's `README.md`. The existing `SHA256SUMS` check proves the tree matches its own manifest — regenerate the manifest after an edit and it certifies whatever the tree now holds. The pin check is the half that manifest cannot do.
- `.github/CODEOWNERS` now covers the paths a change could route around a guard through: `bun.lock`, `.bun-version`, every workspace `package.json`, `bunfig.toml` at any depth, and the five `wrangler.toml`/`wrangler.jsonc` files that name production routes and bindings.
- `.github/workflows/ci.yml` declares `permissions: contents: read`. Nothing in it writes an issue, a comment or a package, and the default token is write-all on this repository.
- `check:release-age-excludes` runs in `lefthook.yml` on pre-push, not only in CI, and it now also refuses a second `bunfig.toml` below the repository root. Bun reads the file nearest the working directory, and several scripts run with `--cwd`, so a second one would set the install policy for those runs while the guard went on passing against the root file.
- The re-vendor recipe in `tools/oxlint/anti-slop/README.md` generates the manifest with `find . ! -type d` rather than `-type f`, so it agrees with the checker's `git ls-files` on what counts as a file. A vendored symlink used to read as a spurious diff.
