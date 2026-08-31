---
title: Connection Recommender — Main Parameters
aliases: [suggested connections, people you may know, recommender transparency]
tags: [compliance, dsa, recommenders]
related:
  - "[[dsa]]"
  - "[[social-graph]]"
  - "[[index]]"
last-reviewed: 2026-08-31
---

# Connection Recommender — Main Parameters

DSA Art. 27 requires the main parameters of a recommender system to be set
out for recipients "in plain and intelligible language." This page is that
disclosure, for the one recommender in scope here: `suggestConnections()`,
which powers the "Suggested for you" surface on the `@osn/social` Discover
page. It is source material for a future ToS — see **Scope** below — not a
ToS itself.

Everything on this page is verified against
`osn/api/src/services/recommendations.ts` as of 2026-08-31 (the
`perf/osn-recommender-fanout` change, osn-tracker#574). **If that function
changes, this page is stale until someone checks it again** — a disclosure
describing an old ranker is worse than no disclosure, because it is
actively misleading. Re-verify it against the source alongside
[[social-graph]] §Recommendations whenever `suggestConnections()` changes.

## 1. How a suggestion is ranked

Ranked by number of mutual connections (people you and the suggested
profile both know), then by number of organisations you both belong to, in
that order. Ties break on the profile's internal ID, which has no meaning
to a recipient beyond making the order the same on repeat requests.

No other signal affects rank. There is no engagement score, no recency
weighting, no personalisation beyond your own connections and
organisations, and no experiment or A/B variant that changes the order for
some users and not others.

Source: `recommendations.ts:672-676` —
`.toSorted(([idA, a], [idB, b]) => b.mutualCount - a.mutualCount || b.organisationCount - a.organisationCount || (idA < idB ? -1 : idA > idB ? 1 : 0))`.

## 2. Where candidates come from

Two sources, both capped:

- **Connections of your connections** ("friends of friends") —
  `recommendations.ts:505-520`, capped at `MAX_FOF_FANOUT_ROWS`
  (`recommendations.ts:65`, currently 10,000 rows read per request).
- **Co-members of organisations you belong to** —
  `recommendations.ts:522-620`, capped at `MAX_ORG_COMEMBER_ROWS`
  (`recommendations.ts:83`, currently 2,000 rows read per request, split
  evenly across the organisations you belong to).

Nobody outside those two sources — not "people nearby," not "people who
viewed your profile," not any directory search — is ever a candidate.

## 3. What gets suppressed

Before ranking, the candidate pool is narrowed. This is a description of
what the system *does*, not an absolute guarantee — see the caveat at the
end of this section.

- **Accounts you have blocked, or that have blocked you** — checked both
  directions (`recommendations.ts:445-452`, `:486-490`).
- **Existing connections and pending requests, in either direction** —
  every edge you have, whatever its status, not only accepted ones
  (`recommendations.ts:428-444`, excluded at `:486-490`). This is why a
  connection request already sent or received never reappears as a
  suggestion.
- **Accounts pending erasure** — a candidate is only hydrated into a
  suggestion through an inner join that requires `accounts.deleted_at IS
  NULL` (`recommendations.ts:710-712`), so an account mid-deletion under
  Art. 17 never surfaces.

**Caveat.** The exclusion set (blocks, connections, pending requests) is
built from at most `MAX_MY_EDGE_ROWS` edge rows — 1,000
(`recommendations.ts:55`, `.limit()` at `:444`). For the overwhelming
majority of accounts this is every edge they have. For an account with
more than 1,000 edges, the exclusion set is built from the first 1,000
read, not a guaranteed-complete list — so "already-connected accounts are
excluded" is what the system does with the edges it reads, not an absolute
promise for every caller regardless of how many connections they have.

## 4. No commercial input

No advertising, no payment, and no paid placement is an input to this
recommender. Nobody can pay to appear, rank higher, or be excluded from
appearing to someone else. If that ever changes, Art. 26 (advertising
transparency) applies in addition to this page, and this page needs a
rewrite before it ships.

## What this recommender discloses about you

Each suggestion the endpoint returns carries a `mutualCount` — the exact
number of mutual connections. This is itself a disclosure with a privacy
cost tracked separately: see `S-L4` in `xchromo/osn-tracker` and
[[social-graph]] §Recommendations. It is noted here because "how many
mutual connections you have with someone" is a fact about you the ranking
parameters (§1) make visible, which Art. 27 disclosure should not omit.

## Scope

This page describes the recommender. **It is not a Terms of Service.**
Publishing the actual DSA Art. 27 disclosure to end users — the ToS
language, where it lives, how it is kept current — is
`xchromo/osn-tracker#373`, which carries `needs:decision` and is not
resolved by this page. A ToS author can draw the four points above
directly into ToS prose; this page is written so they can.

See [[dsa]] §Project changes required, item 6 (`C-L8`) for the
tracker-level entry this page fulfils, and the same item for the other two
recommenders in scope (Pulse discovery, OSN people/organisation search) —
neither is described by this page.
