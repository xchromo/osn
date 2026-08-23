#!/usr/bin/env bun
/**
 * CI guard: fail the build if an entry in `bunfig.toml`'s
 * `install.minimumReleaseAgeExcludes` has no expiry, or has outlived one.
 *
 * The bug class this guards against: `minimumReleaseAge` makes every install
 * wait out a soak window before a fresh publish can land, so a compromised
 * publish has days to get caught before this repo installs it. An entry in
 * `minimumReleaseAgeExcludes` is a deliberate hole in that — some package
 * needs the newest release right now. That is fine as a temporary exception
 * and a permanent hole otherwise: prose above the array ("drop this once X
 * clears") is not read by anything, so the entry survives the reason it was
 * added and quietly exempts every future publish of that package name from
 * the gate forever.
 *
 * The fix is a machine-readable marker, one per excluded name, living
 * anywhere in a `bunfig.toml` comment:
 *
 *   # DROP AFTER <package-name> <YYYY-MM-DD>
 *
 * `<package-name>` must match the exclude list entry exactly. This script
 * fails when an excluded name has no such marker, or when the marker's date
 * has passed — in both cases the fix is the same: remove the name from
 * `minimumReleaseAgeExcludes` (or add/renew the marker if the exception is
 * still live) and, in the removed-entry style already used in this file,
 * record why it went.
 */

const MARKER = /^#\s*DROP AFTER\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s*$/;

export type Finding = {
  readonly name: string;
  readonly problem: string;
};

type BunfigInstall = { readonly minimumReleaseAgeExcludes?: readonly unknown[] };
type Bunfig = { readonly install?: BunfigInstall };

/**
 * Every `# DROP AFTER <name> <date>` marker in the file, keyed by name. The
 * marker only needs to appear somewhere in the comment block above the
 * excludes array — this scans every line, not just the ones immediately
 * preceding it, so marker order or placement is not load-bearing.
 */
function markers(toml: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();

  for (const rawLine of toml.split("\n")) {
    const match = MARKER.exec(rawLine.trim());
    if (match) found.set(match[1]!, match[2]!);
  }

  return found;
}

export function checkReleaseAgeExcludes(toml: string, now: Date = new Date()): readonly Finding[] {
  const parsed = Bun.TOML.parse(toml) as Bunfig;
  const excludes = parsed.install?.minimumReleaseAgeExcludes ?? [];
  const marked = markers(toml);
  const today = now.toISOString().slice(0, 10);
  const findings: Finding[] = [];

  for (const entry of excludes) {
    if (typeof entry !== "string") continue; // not this guard's job — bun's own parse rejects a malformed array

    const dropDate = marked.get(entry);

    if (dropDate === undefined) {
      findings.push({
        name: entry,
        problem: `no "# DROP AFTER ${entry} <YYYY-MM-DD>" marker comment found`,
      });
      continue;
    }

    // The marker reads "DROP AFTER <date>" — the entry is still valid through
    // that date and expired the day after, so today has to be strictly later.
    if (dropDate < today) {
      findings.push({
        name: entry,
        problem: `drop-trigger "DROP AFTER ${entry} ${dropDate}" has passed (today is ${today})`,
      });
    }
  }

  return findings;
}

if (import.meta.main) {
  const path = "bunfig.toml";
  const file = Bun.file(new URL(`../${path}`, import.meta.url));

  if (!(await file.exists())) {
    console.error(`❌ check-release-age-excludes: ${path} not found`);
    process.exit(1);
  }

  const findings = checkReleaseAgeExcludes(await file.text());

  if (findings.length > 0) {
    console.error(`❌ check-release-age-excludes: ${path} has an expired or unmarked exclude.`);
    for (const { name, problem } of findings) console.error(`   ${name} — ${problem}`);
    console.error("");
    console.error("   Remove the name from minimumReleaseAgeExcludes (renewing or adding");
    console.error('   a "# DROP AFTER <name> <YYYY-MM-DD>" marker if the exception is still');
    console.error("   live), and record why in the comment block above it.");
    process.exit(1);
  }

  console.log(`✅ check-release-age-excludes: ${path} has no expired or unmarked excludes.`);
}
