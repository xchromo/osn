import type { Item } from "./types";

/**
 * Items whose prose discloses a live weakness even though their section says they are
 * ordinary planned work. Section routing cannot see this -- an item titled "Cloudflare
 * Turnstile" sitting under "Up Next" reads as a chore until you get to the sentence
 * saying a production endpoint is ungated right now.
 *
 * Every entry here was flagged by an adversarial read of all 197 public-bound items and
 * then confirmed against the source. `titleIncludes` is matched against the parsed item,
 * so an edit that moves or rewrites the line fails the run instead of quietly publishing
 * it: see the `overrides-matched` gate in assert.ts.
 *
 * Publishing a finding is the one unrecoverable mistake in this migration. When a call is
 * close, it goes here.
 */
export type Override = {
  file: string;
  line: number;
  titleIncludes: string;
  area: "security" | "performance" | "compliance";
  product?: string;
  why: string;
};

export const PRIVATE_OVERRIDES: Override[] = [
  {
    file: "wiki/TODO.md",
    line: 15,
    titleIncludes: "Cloudflare Turnstile",
    area: "security",
    why: "Names a production endpoint that is ungated today, and the date its key was removed.",
  },
  {
    file: "wiki/TODO.md",
    line: 27,
    titleIncludes: "Bot fleet on",
    area: "security",
    product: "osn-core",
    why: "Unfixed abuse path: per-IP limiters bypassed by rotating IPs, the anonymous endpoint that carries it, and how much of the daily Worker budget is already spent. Labelled product:pulse but entirely OSN.",
  },
  {
    file: "wiki/TODO.md",
    line: 302,
    titleIncludes: "DPIA filing under GDPR",
    area: "compliance",
    why: "An unmet regulatory filing gate and a special-category data classification. Compliance posture, not a feature.",
  },
  {
    file: "wiki/TODO.md",
    line: 528,
    titleIncludes: "Enforce access-token",
    area: "security",
    why: "A deferred hardening step in production token verification, with the condition that gates it.",
  },
  {
    file: "wiki/TODO.md",
    line: 551,
    titleIncludes: "Redis pub/sub eviction",
    area: "security",
    why: "Says revoked keys keep verifying across processes for a bounded window, and names the TTL knob and its default.",
  },
  {
    file: "wiki/TODO.md",
    line: 992,
    titleIncludes: "Migrate `@zap/api` from shared-secret",
    area: "security",
    product: "zap",
    why: "States which service still verifies against a shared secret and calls it the weakest of the set. Labelled product:osn-core but the work is entirely @zap/api.",
  },
];

export function overrideFor(item: Item): Override | null {
  return (
    PRIVATE_OVERRIDES.find(
      (o) =>
        o.file === item.sourceFile &&
        o.line === item.sourceLine &&
        item.title.includes(o.titleIncludes),
    ) ?? null
  );
}
