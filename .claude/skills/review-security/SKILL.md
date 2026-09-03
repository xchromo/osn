---
name: review-security
description: Use when reviewing a branch diff for security concerns — auth, tokens and sessions, injection, secrets, cookies, CSP and third-party content — and reporting findings with S-C/H/M/L IDs in the four-field format.
---

Review the current branch diff for security and compliance defects.

`$ARGUMENTS` may name the changed workspaces and the branch. Whether or not it does, start from the diff.

## Step 0 — Write the report skeleton before you review anything

Do this before the diff, before reading a line of source. The file is the
deliverable: a run that leaves a differently-shaped file has produced nothing,
however good the analysis inside it. Writing the shape now means the rest of the
run only fills it in. Leaving it until the end is how a section goes missing.

Copy this verbatim. The report file is `SECURITY-REVIEW.md` unless the task
named another:

```bash
cat > SECURITY-REVIEW.md <<'EOF'
## Security findings

None

## Compliance findings

None

## Coverage

None

## Sections checked

None
EOF
```

Those four `##` headings are the whole permitted set, and that is their order.
Each keeps its name exactly — `## Findings` is not `## Security findings`.
Replace a `None` as you fill its section in; leave it where the section really
is empty. Never add a fifth `##`. The ones that get invented are `## Summary`,
`## Verified strengths`, `## Scope and method`, `## Verdict` and `## Bottom
line`, and none of them is allowed: a summary sentence goes at the top of
`## Security findings`, a control you checked and found sound goes on its line
in `## Coverage` or `## Sections checked`, and an environment caveat goes at the
end of `## Sections checked`.

**From here on this file is only ever edited, never rewritten.** Every later
change replaces a `None`, or inserts text under a heading that already exists.
Do not compose the report in your head and write it out whole at the end — a
single write to `SECURITY-REVIEW.md` discards the shape this step just
established, and that is the one way this run fails outright however good the
analysis is. If you find yourself about to write the whole file, you have lost
the skeleton: read it back first and edit what is there.

**A finding is a bold label, not a heading.** ``S-H1`` goes on its own line as
bold text inside `## Security findings`, exactly as **Finding format** shows below.
Promoting it to `## S-H1` adds a top-level section, and a run whose findings
each became a heading fails the shape check with four correct sections still
sitting in the file. The same goes for `## Summary`, `## Filing notes` and
anything else the analysis suggests along the way.

What each section holds is under **Report shape** at the end of this file.

## Step 1 — Route the diff

Resolve the base branch first. A stacked branch does not merge into `main`, and diffing against `main` reports the parent branch's files as this branch's:

```bash
BASE=$(git config --get branch.$(git branch --show-current).gh-merge-base || echo main)
git diff --name-only "$BASE"...HEAD
```

Keep that file list. Every file on it gets a verdict in the report, including the ones you clear.

Now grep the diff for the strings below. **A hit makes the named section mandatory**: you work every bullet in that section against **the whole changed file the hit landed in**, not against the matched line, and you record the verdict under `## Sections checked`. A section nothing matched is optional.

Routing widens attention; it never narrows it. **A grep hit is a reason to open a section, never a reason to stop reading.** Some of these patterns fire on ordinary code — `${` on any template literal, `%` on a modulo in a test assertion, `consent` on this repo's social-graph consent gate, which has nothing to do with cookies. When every hit in a section is that kind, write one line under `## Sections checked` naming what matched and why the section does not apply, then move on. Never satisfy a bullet with code that is not in the diff — a CORS setting the branch did not touch is not this review's finding.

```bash
git diff "$BASE"...HEAD | grep -nE '<pattern>'
```

| Grep the diff for | Sections that become mandatory |
|---|---|
| `document.cookie`, `Set-Cookie`, `setCookie`, `cookie.set`, `__Host-`, `SameSite`, `max-age` (grep `-i`, the header spells it `Max-Age=` and the option `maxAge`) | Cookies |
| `consent`, `revoke`, `withdraw`, `optOut`, `denied`, `granted` | Cookies, Compliance → subprocessors |
| `<script`, `<iframe`, `src="https://`, `googletagmanager`, `maps.googleapis`, `pinterest` | Cookies, Compliance → subprocessors, Configuration |
| `randomBytes`, `Math.random`, `crypto.getRandomValues`, `.toString(36)`, `%` (a modulo applied to random bytes biases the output) | Tokens & Sessions, Cryptography |
| `` sql` ``, `${`, `Bun.spawn`, `exec(`, `LIKE` | Injection |
| `redirect`, `return_url`, `next=`, `location.href =` | Redirects |
| a new `Dialog`, `onClick`, `role=`, `aria-`, `<img` | Compliance → EAA / accessibility |
| `new Elysia(`, `.derive(`, `onBeforeHandle`, `session`, `jwt`, `verify`, `requireAuth`, `ownership` | Auth & Authorisation, Tokens & Sessions |
| two or more exported handlers over the same resource in one file — `send`/`list`, `create`/`delete`, `add`/`remove`, or a name and the same name with a suffix (`sendMessage` beside `sendC2bMessage`) | Auth & Authorisation — the sibling-verb comparison below is mandatory |

## Step 2 — Work the mandatory sections

Read every changed source file in full, then take each mandatory section one bullet at a time. A bullet names a property the code is supposed to have: find the code that would carry that property, and check whether it does. A bullet you cannot tie to any line of the diff is cleared. A bullet whose code you found and whose property is missing is a finding — write it up before moving to the next bullet, or you will lose it.

**Check the shape once, as soon as the first finding is in the file.** Not at the
end — by then a clobbered skeleton has cost the whole run, and the same two
counts that catch it later catch it here for one command:

```bash
grep -c '^## \(Security findings\|Compliance findings\|Coverage\|Sections checked\)$' SECURITY-REVIEW.md
```

It must print `4`. If it prints less, the skeleton from Step 0 was overwritten
rather than edited: restore the 4 headings, put the finding back under the right
one, and edit from then on.

The sections below are the checklists. Sections nothing routed to are still worth a skim, but the routed ones are not optional.

**A comment is a claim, not a control.** A block explaining why a cookie is safe,
why a token is single-use, or why an input needs no validation is the author's
intent. The control is the code. Read the code the comment describes and decide
from that — a reassuring comment over a missing check is the worst case in this
file, and a `TODO` beside a control that is present is not a finding at all.
The same applies in reverse: **do not report a name.** `CONSENT_COOKIE_NAME`
existing is not proof it is the name that gets written; follow it to the write.

---

## Authentication & Authorisation (OWASP A01, A07)

- New Elysia routes missing auth middleware or guards
- Endpoints that allow a user to read/mutate another user's resources without ownership checks
- **A predicate enforced on one verb and not on its sibling on the same resource.** This is not found by reading a handler; it is found by comparing handlers. Do it as a step, not as a glance:

  1. List every exported function in each changed service and route file — `grep -n '^export const\|^export function' <file>`.
  2. Group them by the resource they read or write: every function that touches `messages`, every function that touches `chat_members`.
  3. For each group, write down what each member checks before it touches the row — the membership check, the ownership check, and **every read of a discriminator column**: `class`, `role`, `status`, `kind`, `visibility`, `state`.
  4. A check that appears in some members of a group and not in others is a finding, and the defect is the **absence**, not the presence. Name the sibling that enforces it: that sibling is the proof the check was meant to apply, and a reviewer who reads only the unguarded handler cannot see it.

  Where exactly one member of a group runs a check nobody else runs, ask what that column is for and which of the group's other members the answer implicates. An asymmetry the code explains — a public read beside an owner-only write — is not a finding; say so on its line rather than reporting it. Put the group table in `## Sections checked`.

## Tokens & Sessions (OWASP A07)

- New server-side tokens (session IDs, verification codes, password-reset tokens, recovery codes, CSRF tokens) generated with fewer than 112 bits of entropy from a CSPRNG — flag `Math.random`, short `randomBytes` calls, and weak encodings
- Sensitive server-side tokens (session, password-reset, recovery) stored as plaintext rather than SHA-256 hashes at rest — OSN convention is hashed storage
- Single-use tokens (email verification, password reset, recovery code, OTP step-up) where the delete is not atomic with the validation read
- New sign-in flows that reuse a pre-auth session instead of rotating to a fresh one (session fixation)
- Flows that verify/change email, change password, enrol or remove MFA, or escalate a role without revoking the user's other sessions
- Session or access tokens accepted from URL query strings or form fields (should only come from cookies or `Authorization` headers)
- New routes that embed a token in the URL path/query without setting `Referrer-Policy: strict-origin`
### Every JWT verification call: tabulate its options

Do this as a step, not as a glance. `jose` and every library like it validate
what you name and silently skip what you do not, so a verifier's security is
decided entirely by the options object — and the options object is the one part
a reviewer reading the wrapper never sees.

For each `jwtVerify`, `verify(` or equivalent in the diff, open the call, read
the literal options object, and write a row per claim into `## Sections
checked`: the claim, whether it is **required to be present**, and whether its
**value is pinned**. Then apply these three:

1. **`exp` absent from `requiredClaims` is a finding.** `jose` checks `exp` only
   when the token carries one. A token minted with no `exp` therefore verifies
   for as long as the signing key lives, and nothing downstream looks at age.
   Passing `clockTolerance`, `maxTokenAge` on some other path, or a short TTL at
   the *issuer* does not close it — the verifier is the control. The remedy is
   `requiredClaims: ["exp"]` on this call.
2. **A claim applied conditionally is a claim not enforced.** `if (issuer)
   options.issuer = issuer`, `...(aud && { audience: aud })`, a default of `""`
   or `undefined` — each turns a missing or empty config value into "no check"
   instead of a startup failure. With `iss` off, any token signed by a key the
   configured JWKS serves is accepted whoever minted it, which is the only thing
   separating one deployment tier's tokens from another's. Report the
   conditional itself, and say that an empty string must be a configuration
   error rather than a silent opt-out.
3. **A comment arguing for the gap does not close it.** These files carry
   rollout-safety notes explaining why a check is optional today. That is
   context for the tier, not enforcement; see the rule at the top of Step 2.

## Cookies

- **Every cookie the diff sets: check the prefix.** Find each `Set-Cookie`, `setCookie`, or `cookie.set` call. A cookie that stores a user's decision or identity (consent record, session, preference) must have a name starting `__Host-`. Without that prefix, a script on any sibling origin under the same registrable domain can set a `Domain`-scoped cookie of the same name that shadows the one this app wrote, and the guest's stored refusal silently becomes someone else's value. `Secure`, `HttpOnly` and `SameSite` do not close this — a shadowing cookie satisfies all three. `__Host-` implies `Secure`, host-only and `Path=/`, so the shadow cannot be written at all
- **Then check its dev fallback.** The `__Host-` prefix is rejected over plain `http`, so a hardcoded `__Host-` name drops the cookie entirely on `http://localhost`. The name must fall back to the unprefixed form when the origin is not HTTPS
- Missing `SameSite`, `Secure`, or `HttpOnly` on a cookie that carries authentication or a stored decision
- **Every grant the diff honours: find its teardown.** For each place a granted category causes something to load — an embed, a script tag, an iframe, an observer, a listener — find the code that runs when that grant is withdrawn. Search `revoke`, `withdraw`, `denied`, `onCleanup`, and the falsy branch of the same condition that mounted it. Code that only prevents *further* loading is not teardown: whatever an earlier grant already mounted keeps its network access and its cookies until the next reload, so the withdrawal does not take effect. No unmount path is a finding

## Password & MFA Flows

- Passwords stored with fast hashes (MD5, SHA-1, SHA-256, etc.) rather than Argon2id / Scrypt / Bcrypt
- Hash or token equality checks using `===` / `==` / string equality instead of constant-time comparison
- Login, register, password-change, or MFA-verify endpoints missing rate limiting (password hashing is a DoS vector as well as a brute-force target)
- Auth error messages that distinguish "user not found" from "wrong password", or registration/password-reset responses that reveal whether an email is registered, unless this is an intentional product decision
- TOTP/OTP verify endpoints lacking their own throttle (lockout after N failed attempts), independent of IP-based rate limiting

## WebAuthn

- Challenges that are not single-use and server-bound (accepted more than once, or not tied to server state)
- Verification code that skips checking the RP ID hash, the user-present flag, or the user-verified flag when user verification is required
- Registration flows that don't pass `excludeCredentials`, allowing the same authenticator to be registered twice

## Injection (OWASP A03)

- Raw SQL string construction outside of Drizzle ORM parameterisation
- Unsanitised user input passed to `Bun.spawn`, `exec`, or any shell-equivalent
- Template literals used to build queries or dynamic `eval`-style constructs

## Cryptography (OWASP A02)

- Use of weak algorithms: MD5, SHA-1, DES — anywhere in `@shared/crypto` or elsewhere
- SHA-256 is acceptable for hashing long random server-side tokens, but NOT for passwords — passwords must use Argon2id / Scrypt / Bcrypt
- Hardcoded secrets, API keys, or credentials committed to source files (not `.env`)
- `Math.random()` used for security-sensitive purposes (tokens, nonces, IDs)
- Modulo bias when deriving a bounded integer from random bytes (e.g. `bytes[i] % N` in verification-code or token generators) without rejection sampling or a sufficiently large source
- Message payloads that should be E2E encrypted per project spec but are stored or transmitted in plaintext

## Sensitive Data Exposure (OWASP A04)

- API responses that leak internal fields (password hashes, full user records, internal IDs beyond what the caller needs)
- A request body that reaches a service or a Drizzle call without passing a boundary schema. This repo validates twice and never mixes the two: Elysia TypeBox at the HTTP boundary, Effect Schema inside services (`wiki/architecture/schema-layers.md`). A route handler that hands `body` straight to the database is the finding
- Personally identifiable information written to logs

## Redirects

- User-controlled redirect parameters (`redirect_to`, `next`, `return_url`, etc.) reflected verbatim rather than validated against an allowlist of internal paths or known origins

## Post-Quantum Exposure

- New code that encrypts data with long-term relevance (E2E message payloads, encrypted backups, archived key material, sealed long-lived credentials) using a classical-only KEM or key agreement (X25519, ECDH, plain RSA-OAEP) without a post-quantum hybrid (e.g. ML-KEM-768 + X25519). Harvest-now-decrypt-later makes durable ciphertext the one place this matters — short-lived primitives (JWTs with minute-scale TTLs, TLS session keys, WebAuthn challenges) are explicitly out of scope

## Dependency & Supply Chain (OWASP A06)

- Dependencies that appear unusual or out of place for this codebase (flag for manual review)
- **DO NOT flag caret (`^`) or tilde (`~`) version ranges** — this project uses caret ranges for normal dependencies and tilde ranges for dependencies that don't follow semver or are known to be unstable. The lockfile pins exact versions. This is an intentional convention, not a security concern.

## Configuration

- CORS policy changes that widen allowed origins beyond what is necessary
- Secrets or API keys present in any non-`.env` file

---

## Compliance (GDPR, CCPA, SOC 2, DSA, COPPA, EAA, ePrivacy)

Compliance defects block a merge exactly as security defects do. Use the `C-` prefix (`C-C1`, `C-H1`, `C-M1`, `C-L1`) and report them in their own section after the security findings. See `wiki/compliance/index.md` for the full programme.

The two classes below are checked on every review, because the Step 1 routing sends third-party content and new UI straight to them. GDPR data-mapping, CCPA, COPPA, DSA and SOC 2 live in `reference/compliance.md` — read that file when the diff adds a column, a table, a request body, an endpoint, a moderation action, a ranking surface, or an operator-facing code path.

### Subprocessors / international transfers

- New third-party SDK, npm package making outbound network calls, hosted CDN, image proxy, OAuth provider, analytics tag, geocoder, or any processor that receives personal data on our behalf — needs a row in `wiki/compliance/subprocessors.md`, with a DPA on file and a transfer basis named, before merge.

  **Open the file and look the vendor up; do not assume the row is missing.** A vendor this repo already uses usually has one, and the finding is then not "add a row" — it is which of the row's cells are still open. The DPA and SCC columns carry `TODO` markers for vendors nobody has signed with yet, and a `TODO` there against a third party the branch causes to load for real users is the compliance finding, stated as that. Reporting a row as absent when it is present is a false positive and costs the review its credibility on the ones that are genuinely missing.
- New outbound `fetch` calls to a non-OSN origin from `@pulse/api`, `@osn/api`, `@zap/api`, or any frontend — flag and require justification (vendor row + lawful basis).
- Any change that routes user data outside the EU/EEA without an SCC, adequacy decision, or DTIA on file. Cloudflare (US), Grafana Labs (US), and planned Supabase US-region all need this — flag any new feature that increases the volume of user data flowing to them without revisiting [[subprocessors]].
- New CDN script tags / SRI-less external scripts. ePrivacy-relevant — third-party scripts on the landing site flip us into "consent required".

### EAA / accessibility

- New interactive UI without keyboard reachability (no `tabIndex` story, custom `<div onClick>` instead of `<button>`, missing focus visibility).
- Form inputs without programmatic labels (placeholder-only, missing `<label htmlFor>` or `aria-label`).
- Colour as the only state cue — Pulse event status, Zap unread badge, error vs warning copy.
- Missing alt text on images (event covers, avatars, attachment thumbnails).
- New media (video, audio, voice note) without caption / transcript track.
- Custom ARIA where a Kobalte primitive would do — Kobalte is the accessible default; bespoke ARIA usually means we have invented an inaccessible widget.

### Pre-merge compliance gates

When the diff introduces any of these, the check must be explicit in the report — a gate nobody mentions reads as a gate nobody ran:

- [ ] New third-party processor (SDK, embed, script tag, hosted font, image proxy, geocoder, analytics tag) → `wiki/compliance/subprocessors.md` row present, and its DPA and transfer-basis cells resolved rather than `TODO`
- [ ] New outbound `fetch` or `<script src>` to a non-OSN origin → vendor row + lawful basis confirmed
- [ ] New personal-data field → `wiki/compliance/data-map.md` row added, and `wiki/compliance/retention.md` if it is retention-relevant
- [ ] New interactive UI → keyboard path, programmatic label, and a non-colour state cue confirmed

---

## Finding format

Number each finding with a short ID: `S-C1`, `S-C2`, … for Critical; `S-H1`, `S-H2`, … for High; `S-M1`, … for Medium; `S-L1`, … for Low. Compliance findings use the `C-` prefix (`C-C1`, `C-H1`, `C-M1`, `C-L1`) and are reported in their own section after security findings. Increment the counter within each tier across the full report. This lets findings be referenced unambiguously (e.g. "fix S-H2 before merging" or "address C-M3 before deploying").

Each finding must use this exact structure:

```
**S-H1** — <short title>
**Issue:** What the problem is, stated concisely.
**Why:** Why this is a security concern — the threat, the attack vector, or the OWASP category it falls under.
**Solution:** What was changed or what needs to be done.
**Rationale:** Why this solution correctly addresses the risk.
```

Tier definitions:
- **Critical (S-C)** — exploitable vulnerability; must be fixed before merging
- **High (S-H)** — significant risk; requires a fix or an explicit documented exception
- **Medium (S-M)** — notable concern; should be addressed soon
- **Low (S-L)** — minor issue or hardening suggestion

If no concerns are found, state that explicitly: "No security concerns found."

**A control that is absent is a finding.** Do not downgrade one to a note, an observation, or a "consideration" because exploiting it needs a precondition — an attacker on a sibling origin, a shared machine, a user who revokes mid-session. The precondition is the threat model, not a reason the defect is not there. Rate it `S-L` if the precondition is expensive to reach; do not omit it, and do not describe a missing control as acceptable because the rest of the code is careful.

---

## Report shape

The file already exists — Step 0 wrote it, with the four sections in order.
Keep that. This section says what goes in each one.

`## Security findings` and `## Compliance findings` hold the findings in the
format above, `S-` IDs in the first and `C-` IDs in the second, most severe
first.

`## Coverage` lists **every file** from the Step 1 diff, one line each, with a verdict — a finding ID, or `clear`, or `not source` (lockfiles, generated output, fixtures). A file you did not open is not clear; say you did not open it and why.

`## Sections checked` lists each section Step 1 made mandatory, and under it each bullet in that section, the code you looked at, and the verdict. This is the part that catches a skim: a bullet with no file and no line beside it was not checked.

### Check the file before you finish

Run these two counts on the file you just wrote:

```bash
grep -c '^## \(Security findings\|Compliance findings\|Coverage\|Sections checked\)$' <report-file>
grep -c '^## ' <report-file>
```

Both must print `4`. A first count under 4 means a section was renamed,
demoted to `###`, or overwritten while you were filling it in. A second count above 4 means you added a
top-level section of your own — the usual ones are `## Summary`, `## Verified
strengths`, `## Scope and method`, `## Verdict` and `## Bottom line`. None of
those is allowed as a `##`. A summary sentence goes at the top of `## Security
findings`; a control you checked and found sound goes on its line in `##
Coverage` or `## Sections checked`; an environment caveat goes at the end of
`## Sections checked`.

