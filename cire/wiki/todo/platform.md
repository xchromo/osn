---
title: "Cire TODO — wedding-management platform"
tags: [todo, platform]
related:
  - "[[index]]"
  - "[[platform-plan]]"
  - "[[future]]"
last-reviewed: 2026-07-08
---

# Platform

Build-out of the organiser portal into a full wedding management platform. Architecture, schema sketches, and rationale in [[platform-plan]] — this shard is the actionable checklist. Phases land in order; P1 and the vendor-CRM half of P2 are parallelisable after P0.

## Phase 0 — core-domain refactor (invite decoupling)

- [ ] **Wedding profile** — add `wedding_date`, `location_name`, `location_lat`/`location_lng`, `guest_count_estimate`, `currency`, `budget_total_minor` to `weddings`; Settings module view with manual map-pin location picker
- [ ] **Households ≠ claim codes** — make `families.publicId` nullable (partial unique index); households creatable without a code; "issue invite" (single + bulk via existing re-mint) mints codes from the Invite module
- [ ] **Guest + household CRUD** — organiser create/edit/delete for households and guests; per-guest event-attendance editing (`guest_events` writes); household notes
- [ ] **Event CRUD** — organiser create/edit/delete events without the spreadsheet path
- [ ] **Organiser-recorded RSVPs** — `PUT .../guests/:guestId/rsvps/:eventId` for phone/paper RSVPs; dietary consent-source variant recorded (compliance delta, [[platform-plan]] §10)
- [ ] **Module routers** — reorganise `/api/organiser/weddings/:weddingId/*` into `guests|schedule|invite|vendors|budget|tasks|seating|settings` factories (portal moves in lockstep; decide alias layer — see [[deferred]])
- [ ] **Portal IA** — module sidebar + Overview home (countdown, RSVP totals, task/budget snapshots); extend `dashboard-route.ts` to `#/w/:weddingId/:module/:sub`; `GettingStarted` becomes Overview empty-state; fold in the P-I3 fetch-lifting fix
- [ ] **Roles** — implement `wedding_hosts.role` `editor`/`viewer` + `weddingEditor()` gate; existing co-hosts map to `editor` (closes the root-TODO co-host-roles item)
- [ ] **Pull T-S1 forward** — migration/DDL lockstep test before the schema growth starts

## Phase 1 — planning core

- [ ] **Service-category enum** — closed shared enum in `cire/api/src/lib/service-categories.ts` (vendors + budget + tasks + pricing + metrics)
- [ ] **Checklist** — `tasks` table; versioned lead-time template seeded from `wedding_date`; re-anchor incomplete seeded tasks on date change; day-of tasks link to events (run-sheet view)
- [ ] **Budget v1** — `budget_items` + `payments` tables (minor units, wedding currency); per-category rollup vs total; upcoming-payments feed to Overview
- [ ] **Overview widgets** — RSVP totals, open tasks by bucket, budget summary, payment nudges

## Phase 2 — vendors & services

- [ ] **Vendor CRM (wedding-scoped)** — `vendors` table + status board UI (researching → booked); category filter; `available_on_date` recorded fact; booking creates/links a budget item + ticks matching tasks
- [ ] **Venue link** — `events.venue_vendor_id` so a booked venue attaches to a Schedule event
- [ ] **Directory schema** — global `directory_vendors` + `wedding_vendor_links` (shortlist) + "import to CRM"
- [ ] **Directory search** — lat/lng bounding-box prefilter + haversine order on D1, radius from the wedding's canonical point; dedicated rate limiter
- [ ] **Availability** — `vendor_availability` per-day status; "available on your date" badge in search (badge, not filter-out)
- [ ] **Vendor self-serve** — OSN-account sign-in (`osnAuth()` + listing-ownership authz); listing editor + availability calendar; moderation/`suspended` state before opening claims
- [ ] **Enquiries** — `vendor_enquiries` + messages; quotes feed `budget_items.quoted_minor`; spam limiter
- [ ] **Compliance** — data-map + retention rows for vendor contact PII and enquiry content

## Phase 3 — pricing estimates

- [ ] **Heuristic engine v1** — pure `services/pricing.ts` over versioned `lib/pricing-baselines.ts` (category × region × per-head/flat ranges, season + weekend multipliers); `GET .../budget/estimates` with provenance strings; Budget seeds from it
- [ ] **Directory-informed v2** — blend median quoted amounts by category within radius; k-anonymity floor (~5) before any aggregate is shown

## Phase 4 — seating, comms, registry

- [ ] **Seating** — `seating_tables` + `seating_assignments` per event; drag-drop island; declined/no-response badges; CSV/print export
- [ ] **Guest emails** — new columns + consent design (collection point decision in [[deferred]]); data-map/retention/DPIA delta
- [ ] **Comms** — save-the-date / invite-live / RSVP-chaser emails via `@shared/email`; key-optional fail-soft (prod email currently degraded); comms log + suppression list
- [ ] **Registry** — first candidate after Phase 2 (root-TODO "withjoy parity"); wishing-well payments stay deferred
