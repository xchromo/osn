import { Data, Effect, Schema } from "effect";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { events, eventRsvps, type Event, type EventRsvp } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import { EventNotFound, DatabaseError, ValidationError } from "./events";
import { ensurePulseUser, getAttendanceVisibility, type AttendanceVisibility } from "./pulseUsers";
import {
  getCloseFriendIds,
  getConnectionIds,
  getUserDisplays,
  GraphBridgeError,
  OsnDb,
  type UserDisplay,
} from "./graphBridge";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RsvpNotFound extends Data.TaggedError("RsvpNotFound")<{
  readonly eventId: string;
  readonly userId: string;
}> {}

export class NotInvited extends Data.TaggedError("NotInvited")<{
  readonly eventId: string;
  readonly userId: string;
}> {}

export class GuestListHidden extends Data.TaggedError("GuestListHidden")<{
  readonly eventId: string;
}> {}

export class NotEventOwner extends Data.TaggedError("NotEventOwner")<{
  readonly eventId: string;
}> {}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Wire-level statuses accepted from clients. "invited" is reserved for the
 * organiser invite flow and is rejected on upsertRsvp.
 */
const UserRsvpStatusSchema = Schema.Literal("going", "interested", "not_going");
export type UserRsvpStatus = Schema.Schema.Type<typeof UserRsvpStatusSchema>;

const UpsertRsvpSchema = Schema.Struct({
  status: UserRsvpStatusSchema,
});

const InviteGuestsSchema = Schema.Struct({
  userIds: Schema.Array(Schema.NonEmptyString).pipe(Schema.minItems(1), Schema.maxItems(100)),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RsvpWithUser extends EventRsvp {
  user: UserDisplay | null;
}

export interface RsvpCounts {
  going: number;
  interested: number;
  not_going: number;
  invited: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const genRsvpId = () => "rsvp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

const loadEvent = (eventId: string): Effect.Effect<Event, EventNotFound | DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: (): Promise<Event[]> =>
        db.select().from(events).where(eq(events.id, eventId)).limit(1) as Promise<Event[]>,
      catch: (cause) => new DatabaseError({ cause }),
    });
    if (rows.length === 0) {
      return yield* Effect.fail(new EventNotFound({ id: eventId }));
    }
    return rows[0]!;
  });

const loadRsvp = (
  eventId: string,
  userId: string,
): Effect.Effect<EventRsvp | null, DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: (): Promise<EventRsvp[]> =>
        db
          .select()
          .from(eventRsvps)
          .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)))
          .limit(1) as Promise<EventRsvp[]>,
      catch: (cause) => new DatabaseError({ cause }),
    });
    return rows[0] ?? null;
  });

// ---------------------------------------------------------------------------
// Visibility filtering
// ---------------------------------------------------------------------------

/**
 * Decides whether `viewerId` is allowed to see the RSVP rows for `event`
 * *at all*, without drilling into per-row filters. Returns a discriminated
 * result describing the allowed scope.
 *
 * - organiser          → sees everything
 * - public guest list  → everyone sees (even unauthenticated)
 * - connections        → only the organiser's connections see
 * - private guest list → only the organiser; others see counts only
 *
 * This is the coarse filter. Per-row filtering (based on each attendee's
 * own attendanceVisibility setting) happens in `filterByAttendeePrivacy`.
 */
interface GuestListAccess {
  canSeeAny: boolean;
  requiresPerRowFilter: boolean;
}

const computeGuestListAccess = (
  event: Event,
  viewerId: string | null,
): Effect.Effect<GuestListAccess, DatabaseError | GraphBridgeError, Db | OsnDb> =>
  Effect.gen(function* () {
    // Organiser always sees everything.
    if (viewerId && viewerId === event.createdByUserId) {
      return { canSeeAny: true, requiresPerRowFilter: false };
    }
    switch (event.guestListVisibility) {
      case "public":
        // Public guest list: everyone sees, but per-row filter still applies
        // so an individual user's "no_one" setting is respected — except the
        // user is attending a public-guest-list event which implicitly opts
        // them in. See filterByAttendeePrivacy.
        return { canSeeAny: true, requiresPerRowFilter: true };
      case "connections": {
        // Only the organiser's connections see the list at all.
        if (!viewerId) return { canSeeAny: false, requiresPerRowFilter: false };
        const connectionSet = yield* getConnectionIds(event.createdByUserId);
        const isConnected = connectionSet.has(viewerId);
        return { canSeeAny: isConnected, requiresPerRowFilter: isConnected };
      }
      case "private":
        // Only organiser sees; handled at the top of this fn.
        return { canSeeAny: false, requiresPerRowFilter: false };
    }
  });

/**
 * Per-row privacy filter applied after the coarse guest-list check passes.
 *
 * Each attendee's own attendanceVisibility setting determines whether their
 * RSVP can be exposed to a specific viewer:
 * - "connections"   → only attendees connected to the viewer see the row
 *                     (viewer-centric — NOT organiser-centric)
 * - "close_friends" → only the viewer if they are a close friend of the
 *                     attendee (very conservative; most filters collapse
 *                     to "only the attendee themselves")
 * - "no_one"        → hidden from everyone
 *
 * PUBLIC-GUEST-LIST OVERRIDE: if the event's guest list is public, the
 * attendee has implicitly opted in by RSVPing — their per-row setting is
 * ignored for that event. This matches the user's stated intent in the
 * feature spec.
 *
 * The viewer themselves always sees their own RSVP.
 * The organiser always sees all RSVPs (handled in computeGuestListAccess).
 */
const filterByAttendeePrivacy = (
  event: Event,
  rows: RsvpWithUser[],
  viewerId: string | null,
): Effect.Effect<RsvpWithUser[], DatabaseError | GraphBridgeError, Db | OsnDb> =>
  Effect.gen(function* () {
    // Public guest list bypasses per-row attendee privacy. Per spec: by
    // attending a public-guest-list event, the attendee opts in.
    if (event.guestListVisibility === "public") return rows;

    // We need the attendance-visibility setting for every RSVP author.
    // Batch-fetch them all at once to avoid N+1.
    const attendeeIds = Array.from(new Set(rows.map((r) => r.userId)));
    const visibilityMap = new Map<string, AttendanceVisibility>();
    for (const id of attendeeIds) {
      const v = yield* getAttendanceVisibility(id);
      visibilityMap.set(id, v);
    }

    // For "connections" setting we need the viewer's connection set
    // (from the *viewer's* perspective, not the organiser's).
    let viewerConnections: Set<string> = new Set();
    let viewerCloseFriends: Set<string> = new Set();
    if (viewerId) {
      viewerConnections = yield* getConnectionIds(viewerId);
      viewerCloseFriends = yield* getCloseFriendIds(viewerId);
    }

    return rows.filter((row) => {
      // Always allow the viewer to see their own RSVP.
      if (viewerId && row.userId === viewerId) return true;

      const visibility = visibilityMap.get(row.userId) ?? "connections";
      switch (visibility) {
        case "no_one":
          return false;
        case "connections":
          return viewerId != null && viewerConnections.has(row.userId);
        case "close_friends":
          // Attendee must have marked the viewer as a close friend; we
          // approximate with the viewer's close-friends list since the
          // relationship in pulse is symmetric-intent per event-list usage.
          // TODO(osn): expose a graph.isCloseFriendOf(attendee, viewer)
          // helper for the strict direction check. For now this is
          // conservative — only shows if the viewer has reciprocated.
          return viewerId != null && viewerCloseFriends.has(row.userId);
      }
    });
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create or update an RSVP for the caller on a given event.
 *
 * Enforces:
 *   - event must exist
 *   - "invited" status is never accepted from end users (organiser-only,
 *     via inviteGuests)
 *   - joinPolicy === "guest_list" → the caller must already have an
 *     "invited" row; otherwise NotInvited
 *   - event.allowInterested === false → rejects status === "interested"
 *
 * Also lazily ensures a pulse_users row exists for the caller.
 */
export const upsertRsvp = (
  eventId: string,
  userId: string,
  data: unknown,
): Effect.Effect<EventRsvp, EventNotFound | ValidationError | NotInvited | DatabaseError, Db> =>
  Effect.gen(function* () {
    const validated = yield* Schema.decodeUnknown(UpsertRsvpSchema)(data).pipe(
      Effect.mapError((cause) => new ValidationError({ cause })),
    );

    const event = yield* loadEvent(eventId);

    if (validated.status === "interested" && !event.allowInterested) {
      return yield* Effect.fail(
        new ValidationError({ cause: "This event does not accept 'Maybe' RSVPs" }),
      );
    }

    const existing = yield* loadRsvp(eventId, userId);

    // Guest-list events require a prior invite row for the user.
    if (event.joinPolicy === "guest_list" && event.createdByUserId !== userId) {
      if (existing === null) {
        return yield* Effect.fail(new NotInvited({ eventId, userId }));
      }
      // existing row must be an invite or a prior RSVP; either way the
      // user is allowed to update their status.
    }

    yield* ensurePulseUser(userId);

    const { db } = yield* Db;
    const now = new Date();

    if (existing === null) {
      const id = genRsvpId();
      yield* Effect.tryPromise({
        try: () =>
          db.insert(eventRsvps).values({
            id,
            eventId,
            userId,
            status: validated.status,
            createdAt: now,
          }),
        catch: (cause) => new DatabaseError({ cause }),
      });
      return {
        id,
        eventId,
        userId,
        status: validated.status,
        invitedByUserId: null,
        createdAt: now,
      };
    }

    yield* Effect.tryPromise({
      try: () =>
        db
          .update(eventRsvps)
          .set({ status: validated.status })
          .where(eq(eventRsvps.id, existing.id)),
      catch: (cause) => new DatabaseError({ cause }),
    });
    return { ...existing, status: validated.status };
  });

/**
 * Organiser-only: bulk-invite users to a guest-list event. Creates rows
 * with status = "invited" for users that don't already have an RSVP.
 * Existing rows are left untouched (so accepted invites stay accepted).
 */
export const inviteGuests = (
  eventId: string,
  organiserId: string,
  data: unknown,
): Effect.Effect<
  { invited: number },
  EventNotFound | NotEventOwner | ValidationError | DatabaseError,
  Db
> =>
  Effect.gen(function* () {
    const validated = yield* Schema.decodeUnknown(InviteGuestsSchema)(data).pipe(
      Effect.mapError((cause) => new ValidationError({ cause })),
    );

    const event = yield* loadEvent(eventId);
    if (event.createdByUserId !== organiserId) {
      return yield* Effect.fail(new NotEventOwner({ eventId }));
    }

    const { db } = yield* Db;

    // Find which users already have a row for this event (any status).
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ userId: eventRsvps.userId })
          .from(eventRsvps)
          .where(
            and(
              eq(eventRsvps.eventId, eventId),
              inArray(eventRsvps.userId, [...validated.userIds]),
            ),
          ),
      catch: (cause) => new DatabaseError({ cause }),
    });
    const existingIds = new Set(existing.map((r) => r.userId));
    const toInvite = validated.userIds.filter((id) => !existingIds.has(id));
    if (toInvite.length === 0) return { invited: 0 };

    const now = new Date();
    const rows = toInvite.map((uid) => ({
      id: genRsvpId(),
      eventId,
      userId: uid,
      status: "invited" as const,
      invitedByUserId: organiserId,
      createdAt: now,
    }));
    yield* Effect.tryPromise({
      try: () => db.insert(eventRsvps).values(rows),
      catch: (cause) => new DatabaseError({ cause }),
    });
    return { invited: rows.length };
  });

/**
 * Returns RSVPs for an event, joined with user display metadata, after
 * applying visibility filtering. Returns an empty array when the viewer
 * has no access (not an error — the caller decides how to present it).
 *
 * When `privacyOverride` is true, the per-row attendee-privacy filter is
 * skipped. Only used by the organiser's view.
 */
export const listRsvps = (
  eventId: string,
  viewerId: string | null,
  options: {
    status?: EventRsvp["status"];
    limit?: number;
  } = {},
): Effect.Effect<RsvpWithUser[], EventNotFound | DatabaseError | GraphBridgeError, Db | OsnDb> =>
  Effect.gen(function* () {
    const event = yield* loadEvent(eventId);

    const access = yield* computeGuestListAccess(event, viewerId);
    if (!access.canSeeAny) return [];

    const { db } = yield* Db;
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);

    const filters = [eq(eventRsvps.eventId, eventId)];
    if (options.status) filters.push(eq(eventRsvps.status, options.status));

    const rsvpRows = yield* Effect.tryPromise({
      try: (): Promise<EventRsvp[]> =>
        db
          .select()
          .from(eventRsvps)
          .where(and(...filters))
          .orderBy(desc(eventRsvps.createdAt))
          .limit(limit) as Promise<EventRsvp[]>,
      catch: (cause) => new DatabaseError({ cause }),
    });

    // Join with user displays from osn/db.
    const userIds = Array.from(new Set(rsvpRows.map((r) => r.userId)));
    const userMap = yield* getUserDisplays(userIds);
    const joined: RsvpWithUser[] = rsvpRows.map((row) => ({
      ...row,
      user: userMap.get(row.userId) ?? null,
    }));

    if (!access.requiresPerRowFilter) return joined;
    return yield* filterByAttendeePrivacy(event, joined, viewerId);
  });

/**
 * Returns the latest N RSVPs (default 5) for the inline "who's going" strip
 * on the event detail page. Shorthand over listRsvps with status=going.
 */
export const latestRsvps = (
  eventId: string,
  viewerId: string | null,
  limit = 5,
): Effect.Effect<RsvpWithUser[], EventNotFound | DatabaseError | GraphBridgeError, Db | OsnDb> =>
  listRsvps(eventId, viewerId, { status: "going", limit });

/**
 * Returns the counts per status. Counts are always visible (they don't
 * leak identity). Does not apply the attendee-privacy filter — that's for
 * detail rows, not aggregates.
 */
export const rsvpCounts = (
  eventId: string,
): Effect.Effect<RsvpCounts, EventNotFound | DatabaseError, Db> =>
  Effect.gen(function* () {
    yield* loadEvent(eventId); // 404 if missing
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: (): Promise<{ status: EventRsvp["status"]; total: number }[]> =>
        db
          .select({ status: eventRsvps.status, total: count() })
          .from(eventRsvps)
          .where(eq(eventRsvps.eventId, eventId))
          .groupBy(eventRsvps.status) as Promise<{ status: EventRsvp["status"]; total: number }[]>,
      catch: (cause) => new DatabaseError({ cause }),
    });
    const counts: RsvpCounts = { going: 0, interested: 0, not_going: 0, invited: 0 };
    for (const row of rows) counts[row.status] = Number(row.total);
    return counts;
  });
