import { it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { createTestLayer } from "../helpers/db";
import {
  DEFAULT_ATTENDANCE_VISIBILITY,
  ensurePulseUser,
  getAttendanceVisibility,
  getPulseUser,
  updateSettings,
} from "../../src/services/pulseUsers";

const provide = <A, E>(effect: Effect.Effect<A, E, never>) => effect;

it.effect("getPulseUser returns null when no row exists", () =>
  Effect.gen(function* () {
    const row = yield* getPulseUser("usr_nobody");
    expect(row).toBeNull();
  }).pipe(Effect.provide(createTestLayer()), provide),
);

it.effect("getAttendanceVisibility falls back to the default when no row exists", () =>
  Effect.gen(function* () {
    const v = yield* getAttendanceVisibility("usr_nobody");
    expect(v).toBe(DEFAULT_ATTENDANCE_VISIBILITY);
  }).pipe(Effect.provide(createTestLayer())),
);

it.effect("ensurePulseUser is idempotent", () =>
  Effect.gen(function* () {
    yield* ensurePulseUser("usr_alice");
    yield* ensurePulseUser("usr_alice");
    const row = yield* getPulseUser("usr_alice");
    expect(row).not.toBeNull();
    expect(row!.userId).toBe("usr_alice");
    expect(row!.attendanceVisibility).toBe("connections");
  }).pipe(Effect.provide(createTestLayer())),
);

it.effect("updateSettings creates a row on first update", () =>
  Effect.gen(function* () {
    const row = yield* updateSettings("usr_alice", { attendanceVisibility: "close_friends" });
    expect(row.attendanceVisibility).toBe("close_friends");
  }).pipe(Effect.provide(createTestLayer())),
);

it.effect("updateSettings changes an existing row", () =>
  Effect.gen(function* () {
    yield* updateSettings("usr_alice", { attendanceVisibility: "close_friends" });
    const updated = yield* updateSettings("usr_alice", { attendanceVisibility: "no_one" });
    expect(updated.attendanceVisibility).toBe("no_one");
  }).pipe(Effect.provide(createTestLayer())),
);

it.effect("updateSettings rejects invalid enum values", () =>
  Effect.gen(function* () {
    const err = yield* Effect.flip(
      updateSettings("usr_alice", { attendanceVisibility: "everyone" }),
    );
    expect(err._tag).toBe("ValidationError");
  }).pipe(Effect.provide(createTestLayer())),
);

it.effect("getAttendanceVisibility reads the stored value after update", () =>
  Effect.gen(function* () {
    yield* updateSettings("usr_alice", { attendanceVisibility: "no_one" });
    const v = yield* getAttendanceVisibility("usr_alice");
    expect(v).toBe("no_one");
  }).pipe(Effect.provide(createTestLayer())),
);
