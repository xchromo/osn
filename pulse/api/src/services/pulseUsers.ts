import { Data, Effect, Schema } from "effect";
import { eq } from "drizzle-orm";
import { pulseUsers, type PulseUser } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly cause: unknown;
}> {}

/**
 * Pulse users default to "connections" on first read. This is the Pulse-side
 * counterpart to the OSN user row and is created lazily when a user takes
 * any write action (RSVP, event creation, settings update).
 */
export const DEFAULT_ATTENDANCE_VISIBILITY = "connections" as const;

export type AttendanceVisibility = PulseUser["attendanceVisibility"];

const AttendanceVisibilitySchema = Schema.Literal("connections", "close_friends", "no_one");

const UpdateSettingsSchema = Schema.Struct({
  attendanceVisibility: Schema.optional(AttendanceVisibilitySchema),
});

/**
 * Returns the Pulse user row for this userId, or null if none exists yet.
 * Readers should fall back to the default when null is returned rather than
 * eagerly inserting — writes happen via upsertPulseUser.
 */
export const getPulseUser = (userId: string): Effect.Effect<PulseUser | null, DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: (): Promise<PulseUser[]> =>
        db.select().from(pulseUsers).where(eq(pulseUsers.userId, userId)).limit(1) as Promise<
          PulseUser[]
        >,
      catch: (cause) => new DatabaseError({ cause }),
    });
    return rows[0] ?? null;
  });

/**
 * Returns the user's attendanceVisibility, falling back to the default
 * when no Pulse user row exists yet. Used by the RSVP visibility filter.
 */
export const getAttendanceVisibility = (
  userId: string,
): Effect.Effect<AttendanceVisibility, DatabaseError, Db> =>
  Effect.gen(function* () {
    const row = yield* getPulseUser(userId);
    return row?.attendanceVisibility ?? DEFAULT_ATTENDANCE_VISIBILITY;
  });

/**
 * Ensures a pulse_users row exists for this userId. Idempotent — uses
 * INSERT ... ON CONFLICT DO NOTHING. Safe to call on every write.
 */
export const ensurePulseUser = (userId: string): Effect.Effect<void, DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const now = new Date();
    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(pulseUsers)
          .values({ userId, createdAt: now, updatedAt: now })
          .onConflictDoNothing(),
      catch: (cause) => new DatabaseError({ cause }),
    });
  });

/**
 * Updates the caller's Pulse-side settings. Creates the row if missing.
 */
export const updateSettings = (
  userId: string,
  data: unknown,
): Effect.Effect<PulseUser, ValidationError | DatabaseError, Db> =>
  Effect.gen(function* () {
    const validated = yield* Schema.decodeUnknown(UpdateSettingsSchema)(data).pipe(
      Effect.mapError((cause) => new ValidationError({ cause })),
    );

    yield* ensurePulseUser(userId);

    const { db } = yield* Db;
    const now = new Date();
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(pulseUsers)
          .set({ ...validated, updatedAt: now })
          .where(eq(pulseUsers.userId, userId)),
      catch: (cause) => new DatabaseError({ cause }),
    });

    const rows = yield* Effect.tryPromise({
      try: (): Promise<PulseUser[]> =>
        db.select().from(pulseUsers).where(eq(pulseUsers.userId, userId)).limit(1) as Promise<
          PulseUser[]
        >,
      catch: (cause) => new DatabaseError({ cause }),
    });
    // ensurePulseUser just ran, so the row must exist.
    return rows[0]!;
  });
