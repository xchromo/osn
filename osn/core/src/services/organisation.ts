import { organisations, organisationMembers, users } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";

import { withOrgMemberOp, withOrgOp } from "../metrics";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OrgError extends Data.TaggedError("OrgError")<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListOptions {
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function now(): Date {
  return new Date();
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 100);
}

// ---------------------------------------------------------------------------
// Organisation service factory
// ---------------------------------------------------------------------------

export function createOrganisationService() {
  // -------------------------------------------------------------------------
  // Organisation CRUD
  // -------------------------------------------------------------------------

  const createOrganisation = (
    ownerId: string,
    handle: string,
    name: string,
    description?: string,
  ): Effect.Effect<typeof organisations.$inferSelect, OrgError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Check handle uniqueness across users and organisations
      const [existingUser, existingOrg] = yield* Effect.tryPromise({
        try: () =>
          Promise.all([
            db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1),
            db
              .select({ id: organisations.id })
              .from(organisations)
              .where(eq(organisations.handle, handle))
              .limit(1),
          ]),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (existingUser.length > 0 || existingOrg.length > 0) {
        return yield* Effect.fail(new OrgError({ message: "Handle already taken" }));
      }

      // Verify owner exists
      const ownerRows = yield* Effect.tryPromise({
        try: () => db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (ownerRows.length === 0) {
        return yield* Effect.fail(new OrgError({ message: "Owner not found" }));
      }

      const ts = now();
      const orgId = genId("org_");

      // Insert org + owner as admin in a single transaction
      yield* Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            await tx.insert(organisations).values({
              id: orgId,
              handle,
              name,
              description: description ?? null,
              avatarUrl: null,
              ownerId,
              createdAt: ts,
              updatedAt: ts,
            });
            await tx.insert(organisationMembers).values({
              id: genId("orgm_"),
              organisationId: orgId,
              userId: ownerId,
              role: "admin",
              createdAt: ts,
            });
          }),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const rows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      return rows[0];
    }).pipe(withOrgOp("create"));

  const getOrganisation = (
    orgId: string,
  ): Effect.Effect<typeof organisations.$inferSelect, NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      return rows[0];
    }).pipe(Effect.withSpan("org.get"));

  const getOrganisationByHandle = (
    handle: string,
  ): Effect.Effect<typeof organisations.$inferSelect | null, DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.handle, handle)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      return rows.length > 0 ? rows[0] : null;
    }).pipe(Effect.withSpan("org.get_by_handle"));

  const updateOrganisation = (
    orgId: string,
    callerId: string,
    updates: { name?: string; description?: string },
  ): Effect.Effect<
    typeof organisations.$inferSelect,
    OrgError | NotFoundError | DatabaseError,
    Db
  > =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Check org exists
      const orgRows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      // Check caller is admin
      const memberRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, callerId),
                eq(organisationMembers.role, "admin"),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (memberRows.length === 0) {
        return yield* Effect.fail(
          new OrgError({ message: "Only admins can update the organisation" }),
        );
      }

      const setClause: Record<string, unknown> = { updatedAt: now() };
      if (updates.name !== undefined) setClause.name = updates.name;
      if (updates.description !== undefined) setClause.description = updates.description;

      yield* Effect.tryPromise({
        try: () => db.update(organisations).set(setClause).where(eq(organisations.id, orgId)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const updated = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      return updated[0];
    }).pipe(withOrgOp("update"));

  const deleteOrganisation = (
    orgId: string,
    callerId: string,
  ): Effect.Effect<void, OrgError | NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      const orgRows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      if (orgRows[0].ownerId !== callerId) {
        return yield* Effect.fail(
          new OrgError({ message: "Only the owner can delete the organisation" }),
        );
      }

      yield* Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            await tx
              .delete(organisationMembers)
              .where(eq(organisationMembers.organisationId, orgId));
            await tx.delete(organisations).where(eq(organisations.id, orgId));
          }),
        catch: (cause) => new DatabaseError({ cause }),
      });
    }).pipe(withOrgOp("delete"));

  const listUserOrganisations = (
    userId: string,
    options: ListOptions = {},
  ): Effect.Effect<(typeof organisations.$inferSelect)[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const limit = clampLimit(options.limit);
      const offset = options.offset ?? 0;

      const memberRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ organisationId: organisationMembers.organisationId })
            .from(organisationMembers)
            .where(eq(organisationMembers.userId, userId))
            .limit(limit)
            .offset(offset),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (memberRows.length === 0) return [];

      const orgIds = memberRows.map((r) => r.organisationId);

      const orgs = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(inArray(organisations.id, orgIds)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      return orgs;
    }).pipe(Effect.withSpan("org.list_by_user"));

  // -------------------------------------------------------------------------
  // Membership management
  // -------------------------------------------------------------------------

  const addMember = (
    orgId: string,
    callerId: string,
    targetUserId: string,
    role: "admin" | "member",
  ): Effect.Effect<void, OrgError | NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Check org exists
      const orgRows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      // Check caller is admin
      const callerMember = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, callerId),
                eq(organisationMembers.role, "admin"),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (callerMember.length === 0) {
        return yield* Effect.fail(new OrgError({ message: "Only admins can add members" }));
      }

      // Check target user exists
      const targetRows = yield* Effect.tryPromise({
        try: () =>
          db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (targetRows.length === 0) {
        return yield* Effect.fail(new OrgError({ message: "Target user not found" }));
      }

      // Check not already a member
      const existing = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, targetUserId),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (existing.length > 0) {
        return yield* Effect.fail(new OrgError({ message: "User is already a member" }));
      }

      yield* Effect.tryPromise({
        try: () =>
          db.insert(organisationMembers).values({
            id: genId("orgm_"),
            organisationId: orgId,
            userId: targetUserId,
            role,
            createdAt: now(),
          }),
        catch: (cause) => new DatabaseError({ cause }),
      });
    }).pipe(withOrgMemberOp("add"));

  const removeMember = (
    orgId: string,
    callerId: string,
    targetUserId: string,
  ): Effect.Effect<void, OrgError | NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Check org exists
      const orgRows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      // Cannot remove the owner
      if (orgRows[0].ownerId === targetUserId) {
        return yield* Effect.fail(new OrgError({ message: "Cannot remove the owner" }));
      }

      // Check caller is admin
      const callerMember = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, callerId),
                eq(organisationMembers.role, "admin"),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (callerMember.length === 0) {
        return yield* Effect.fail(new OrgError({ message: "Only admins can remove members" }));
      }

      // Check target is a member
      const targetMember = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, targetUserId),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (targetMember.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Member not found" }));
      }

      yield* Effect.tryPromise({
        try: () =>
          db.delete(organisationMembers).where(eq(organisationMembers.id, targetMember[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    }).pipe(withOrgMemberOp("remove"));

  const updateMemberRole = (
    orgId: string,
    callerId: string,
    targetUserId: string,
    newRole: "admin" | "member",
  ): Effect.Effect<void, OrgError | NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Check org exists
      const orgRows = yield* Effect.tryPromise({
        try: () => db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      // Cannot change the owner's role
      if (orgRows[0].ownerId === targetUserId) {
        return yield* Effect.fail(new OrgError({ message: "Cannot change the owner's role" }));
      }

      // Only the owner can promote/demote
      if (orgRows[0].ownerId !== callerId) {
        return yield* Effect.fail(new OrgError({ message: "Only the owner can change roles" }));
      }

      // Check target is a member
      const targetMember = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, targetUserId),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (targetMember.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Member not found" }));
      }

      yield* Effect.tryPromise({
        try: () =>
          db
            .update(organisationMembers)
            .set({ role: newRole })
            .where(eq(organisationMembers.id, targetMember[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    }).pipe(withOrgMemberOp("update_role"));

  const listMembers = (
    orgId: string,
    options: ListOptions = {},
  ): Effect.Effect<
    { user: typeof users.$inferSelect; role: string; joinedAt: Date }[],
    NotFoundError | DatabaseError,
    Db
  > =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const limit = clampLimit(options.limit);
      const offset = options.offset ?? 0;

      // Check org exists
      const orgRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ id: organisations.id })
            .from(organisations)
            .where(eq(organisations.id, orgId))
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (orgRows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Organisation not found" }));
      }

      const memberRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(organisationMembers)
            .where(eq(organisationMembers.organisationId, orgId))
            .limit(limit)
            .offset(offset),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (memberRows.length === 0) return [];

      const userIds = memberRows.map((m) => m.userId);
      const roleMap = new Map(memberRows.map((m) => [m.userId, m.role]));
      const joinedMap = new Map(memberRows.map((m) => [m.userId, m.createdAt]));

      const memberUsers = yield* Effect.tryPromise({
        try: () => db.select().from(users).where(inArray(users.id, userIds)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      return memberUsers.map((u) => ({
        user: u,
        role: roleMap.get(u.id) ?? "member",
        joinedAt: joinedMap.get(u.id) ?? new Date(),
      }));
    }).pipe(Effect.withSpan("org.member.list"));

  const getMemberRole = (
    orgId: string,
    userId: string,
  ): Effect.Effect<"admin" | "member" | null, DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ role: organisationMembers.role })
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, orgId),
                eq(organisationMembers.userId, userId),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return null;
      return rows[0].role as "admin" | "member";
    }).pipe(Effect.withSpan("org.member.role_check"));

  return {
    createOrganisation,
    getOrganisation,
    getOrganisationByHandle,
    updateOrganisation,
    deleteOrganisation,
    listUserOrganisations,
    addMember,
    removeMember,
    updateMemberRole,
    listMembers,
    getMemberRole,
  };
}

export type OrganisationService = ReturnType<typeof createOrganisationService>;
