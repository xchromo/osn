Set up the OSN development environment. Check each requirement in order and install or configure anything missing.

---

## Project Stack

| Layer | Technology |
|---|---|
| Runtime & package manager | Bun 1.3.10 |
| Monorepo orchestration | Turborepo |
| Backend framework | Elysia + Eden |
| Database | Drizzle ORM + SQLite → Supabase |
| Functional effects | Effect.ts |
| Frontend | SolidJS, Astro |
| Native apps | Tauri 2 (iOS primary, desktop) |
| Native language | Rust (2021 edition) |
| Validation | Valibot |
| Testing | Vitest + @effect/vitest |
| Linting | oxlint |
| Formatting | oxfmt |
| Git hooks | lefthook |
| Versioning | Changesets |
| CI | GitHub Actions |

---

## Step 1 — Homebrew

Run `which brew`. If not found, install it:
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## Step 2 — Bun

Run `bun --version`.

- If not installed: `brew install bun`
- If installed but version does not match `1.3.10` (from `.bun-version`): upgrade with `brew upgrade bun` or install the exact version via `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"`

Verify: `bun --version` should output `1.3.10`.

---

## Step 3 — Rust

Run `rustc --version`.

- If not installed: install rustup (the recommended Rust toolchain manager):
  ```
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
  Then follow the prompts and run `source ~/.cargo/env` (or restart the shell).
- If installed: run `rustup update` to ensure the toolchain is current.

Rust is required for Tauri (`apps/pulse/src-tauri`). The project uses the 2021 edition.

---

## Step 4 — Xcode Command Line Tools (macOS, required for Tauri/iOS)

Run `xcode-select -p`.

- If not installed or returns an error: `xcode-select --install`
- For iOS builds, full Xcode (from the App Store) is required, not just the CLI tools. Run `xcodebuild -version` to verify Xcode is present.

---

## Step 5 — GitHub CLI

Run `gh --version`.

- If not installed: `brew install gh`

Then verify it is fully operational:

1. **Authentication** — run `gh auth status`. If not logged in: `gh auth login` (choose GitHub.com, HTTPS, browser).
2. **Repo access** — run `gh repo view xchromo/osn`. If this fails, the token may lack the `repo` scope — re-authenticate with `gh auth refresh -s repo`.
3. **PR permissions** — run `gh pr list` from the repo root. A successful response (even an empty list) confirms write access is working.

The `gh` CLI is used by `/prep-pr` to open pull requests and by `/new-feat` to check branch state.

---

## Step 6 — Git configuration

Check and apply the following recommended git settings. For each one, run the check command — if it is not already set, show the user what it does and ask whether to apply it. Apply all confirmed settings with `git config --global`.

| Setting | Check | Apply | Why |
|---|---|---|---|
| `rerere.enabled` | `git config --global rerere.enabled` | `git config --global rerere.enabled true` | Records how you resolve merge conflicts and replays the same resolution automatically next time — saves time on long-lived feature branches |
| `push.autoSetupRemote` | `git config --global push.autoSetupRemote` | `git config --global push.autoSetupRemote true` | Makes `git push` work on new branches without needing `-u origin HEAD` every time |
| `pull.rebase` | `git config --global pull.rebase` | `git config --global pull.rebase false` | Uses merge (not rebase) on `git pull`, keeping history straightforward and avoiding accidental rebase surprises |

After applying, confirm by running `git config --global --list | grep -E 'rerere|push.auto|pull.rebase'`.

---

## Step 7 — Install dependencies

From the repo root, run:
```
bun install
```

This installs all workspace dependencies including `oxlint`, `oxfmt`, `lefthook`, `turbo`, and `@changesets/cli`.

---

## Step 8 — Git hooks

Run `bunx lefthook install` to register the pre-commit and pre-push hooks defined in `lefthook.yml`.

Hooks configured:
- **pre-commit**: runs `oxlint` and `oxfmt --check` on staged `.js/.ts/.tsx` files
- **pre-push**: runs `bun run check` (full monorepo type-check via Turbo)

Verify by running `bunx lefthook run pre-commit` — it should complete without error on a clean tree.

---

## Step 9 — Verify the setup

Run the following checks in parallel and report results:

1. `bun run check` — type-checks all packages via Turbo
2. `bun run lint` — oxlint across the monorepo
3. `bun run fmt:check` — oxfmt format validation

If all three pass, the environment is ready. Report any failures with the full output so they can be diagnosed.

---

## Summary of brew dependencies

| Tool | Install command | Required for |
|---|---|---|
| `bun` | `brew install bun` | Everything |
| `gh` | `brew install gh` | `/prep-pr` skill, opening PRs |
| `rustup` / Rust | via `curl` (see step 3) | Tauri native layer |
| Xcode CLT | `xcode-select --install` | Tauri/iOS builds |
