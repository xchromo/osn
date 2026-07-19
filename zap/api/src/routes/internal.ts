import { chatMembers } from "@zap/db/schema";
import { DbLive, Db, type Db as DbType } from "@zap/db/service";
import { inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Elysia, t } from "elysia";

import {
  PERMITTED_INBOUND_SCOPES,
  ServiceKeyMismatchError,
  registerServiceKey,
  requireArc,
  revokeServiceKey,
} from "../lib/arc-middleware";
import { provisionC2bChat } from "../services/chats";
import { sendC2bMessage, listC2bMessages } from "../services/messages";

const AUDIENCE = "zap-api";
const SCOPE_ACCOUNT_EXPORT = "account:export";

function isTimingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // Use a constant-time loop in lieu of Buffer.timingSafeEqual to keep
  // this lib browser/Workers-portable. JS strings are immutable so we can
  // XOR-accumulate both inputs.
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * A single DSAR export line: `{"section": "...", "record": {...}}`.
 * NDJSON — one JSON object per line, `application/x-ndjson`.
 */
interface ExportChatMemberRecord {
  readonly chatId: string;
  readonly role: string;
  readonly joinedAt: string | null;
}

/**
 * Reads the caller's chat memberships for the DSAR export. Message CONTENT
 * (`messages.ciphertext`) is deliberately NOT read — the export surfaces only
 * membership metadata (which chats a profile belongs to, its role, and when it
 * joined), never the E2E-encrypted message bodies.
 */
const loadChatMemberships = (
  profileIds: readonly string[],
): Effect.Effect<ExportChatMemberRecord[], never, DbType> =>
  Effect.gen(function* () {
    if (profileIds.length === 0) return [];
    const { db } = yield* Db;
    const rows = yield* Effect.promise(
      (): Promise<{ chatId: string; role: string; joinedAt: Date | null }[]> =>
        db
          .select({
            chatId: chatMembers.chatId,
            role: chatMembers.role,
            joinedAt: chatMembers.joinedAt,
          })
          .from(chatMembers)
          .where(inArray(chatMembers.profileId, [...profileIds])) as Promise<
          { chatId: string; role: string; joinedAt: Date | null }[]
        >,
    );
    return rows.map((r) => ({
      chatId: r.chatId,
      role: r.role,
      joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
    }));
  }).pipe(Effect.withSpan("zap.internal.account_export"));

/**
 * Internal zap-api endpoints — ARC-gated (account-export) and
 * shared-secret-gated (register-service / service-keys/:keyId revoke).
 */
export const createInternalRoutes = (dbLayer: Layer.Layer<DbType> = DbLive) => {
  // Layer graph built once per factory (convention: build the runtime once,
  // never per request) — mirrors pulse/api's internal router.
  const runtime = ManagedRuntime.make(dbLayer);
  return (
    new Elysia({ prefix: "/internal" })
      // ------------------------------------------------------------------
      // ARC public-key registration. Mirrors osn-api's
      // /graph/internal/register-service. osn-api calls this on startup with
      // the shared INTERNAL_SERVICE_SECRET to register the outbound key it
      // will use when fanning out a DSAR export to Zap.
      // ------------------------------------------------------------------
      .post(
        "/register-service",
        async ({ body, headers, set }) => {
          const secret = process.env.INTERNAL_SERVICE_SECRET;
          if (!secret) {
            set.status = 501;
            return { error: "Service registration is disabled on this instance" };
          }
          if (!isTimingSafeEqual(headers["authorization"] ?? "", `Bearer ${secret}`)) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          const requestedScopes = body.allowedScopes
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          const invalid = requestedScopes.filter((s) => !PERMITTED_INBOUND_SCOPES.has(s));
          if (invalid.length > 0) {
            set.status = 400;
            return { error: `Unknown scopes: ${invalid.join(", ")}` };
          }

          try {
            await registerServiceKey({
              serviceId: body.serviceId,
              keyId: body.keyId,
              publicKeyJwk: body.publicKeyJwk,
              // Persist only the permitted subset (defence in depth — the
              // check above already rejects any unknown scope).
              allowedScopes: requestedScopes.join(","),
              expiresAt: body.expiresAt,
            });
            return { ok: true };
          } catch (e) {
            if (e instanceof ServiceKeyMismatchError) {
              set.status = 409;
              return { error: "kid_serviceid_mismatch" };
            }
            set.status = 400;
            return { error: "Invalid public key JWK" };
          }
        },
        {
          body: t.Object({
            serviceId: t.String({ minLength: 1 }),
            keyId: t.String({ minLength: 1 }),
            publicKeyJwk: t.String({ minLength: 1 }),
            allowedScopes: t.String({ minLength: 1 }),
            expiresAt: t.Optional(t.Number()),
          }),
        },
      )
      .delete(
        "/service-keys/:keyId",
        ({ params, headers, set }) => {
          const secret = process.env.INTERNAL_SERVICE_SECRET;
          if (!secret) {
            set.status = 501;
            return { error: "Service registration is disabled on this instance" };
          }
          if (!isTimingSafeEqual(headers["authorization"] ?? "", `Bearer ${secret}`)) {
            set.status = 401;
            return { error: "Unauthorized" };
          }
          revokeServiceKey(params.keyId);
          return { ok: true };
        },
        { params: t.Object({ keyId: t.String({ minLength: 1 }) }) },
      )
      // ------------------------------------------------------------------
      // ARC-gated `/internal/account-export` — called by osn-api when
      // fanning out a DSAR account export (C-H1). Returns NDJSON: one
      // `{"section":"zap.chats","record":{...}}` line per chat membership of
      // the supplied profile IDs. Message content is EXCLUDED.
      // ------------------------------------------------------------------
      .post(
        "/account-export",
        async ({ body, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            AUDIENCE,
            SCOPE_ACCOUNT_EXPORT,
          );
          if (!caller) return { error: "Unauthorized" };

          const records = await runtime.runPromise(loadChatMemberships(body.profile_ids));

          // Buffered NDJSON — one JSON object per line, no trailing newline
          // beyond each record's own. Empty profile set → empty body.
          const ndjson = records
            .map((record) => JSON.stringify({ section: "zap.chats", record }))
            .join("\n");

          set.status = 200;
          set.headers["content-type"] = "application/x-ndjson";
          return ndjson;
        },
        {
          body: t.Object({
            account_id: t.String(),
            profile_ids: t.Array(t.String()),
          }),
        },
      )
      // ------------------------------------------------------------------
      // ARC-gated `/internal/chats` — called by cire-api to provision
      // consumer-to-business chats (scope: `chat:c2b`).
      // ------------------------------------------------------------------
      .post(
        "/chats",
        async ({ body, headers, set }) => {
          const caller = await requireArc(headers.authorization, set, AUDIENCE, "chat:c2b");
          if (!caller) return { error: "Unauthorized" };

          const result = await runtime.runPromise(
            provisionC2bChat({
              memberProfileIds: body.memberProfileIds,
              createdByProfileId: body.createdByProfileId,
              title: body.title,
            }).pipe(
              Effect.catchTag("ValidationError", () =>
                Effect.sync(() => {
                  set.status = 400;
                  return { error: "Invalid request" } as const;
                }),
              ),
              Effect.catchTag("DatabaseError", () =>
                Effect.sync(() => {
                  set.status = 500;
                  return { error: "Internal server error" } as const;
                }),
              ),
            ),
          );
          if ("error" in result) return result;
          set.status = 201;
          return { chatId: result.id };
        },
        {
          body: t.Object({
            memberProfileIds: t.Array(t.String(), { minItems: 2 }),
            createdByProfileId: t.String({ minLength: 1 }),
            title: t.Optional(t.String()),
          }),
        },
      )
      // ------------------------------------------------------------------
      // ARC-gated `POST /internal/chats/:chatId/messages` — send a
      // server-visible (plaintext) message into a c2b chat.
      // ------------------------------------------------------------------
      .post(
        "/chats/:chatId/messages",
        async ({ body, headers, params, set }) => {
          const caller = await requireArc(headers.authorization, set, AUDIENCE, "chat:c2b");
          if (!caller) return { error: "Unauthorized" };

          const result = await runtime.runPromise(
            sendC2bMessage(params.chatId, body.senderProfileId, { body: body.body }).pipe(
              Effect.catchTag("ValidationError", () =>
                Effect.sync(() => {
                  set.status = 400;
                  return { error: "Invalid request" } as const;
                }),
              ),
              Effect.catchTag("ChatNotFound", () =>
                Effect.sync(() => {
                  set.status = 404;
                  return { error: "Chat not found" } as const;
                }),
              ),
              Effect.catchTag("NotC2bChat", () =>
                Effect.sync(() => {
                  set.status = 409;
                  return { error: "Not a c2b chat" } as const;
                }),
              ),
              Effect.catchTag("NotChatMember", () =>
                Effect.sync(() => {
                  set.status = 403;
                  return { error: "Sender is not a chat member" } as const;
                }),
              ),
              Effect.catchTag("DatabaseError", () =>
                Effect.sync(() => {
                  set.status = 500;
                  return { error: "Internal server error" } as const;
                }),
              ),
            ),
          );
          if ("error" in result) return result;
          set.status = 201;
          return {
            messageId: result.id,
            createdAt: result.createdAt.toISOString(),
          };
        },
        {
          params: t.Object({ chatId: t.String({ minLength: 1 }) }),
          body: t.Object({
            senderProfileId: t.String({ minLength: 1 }),
            body: t.String({ minLength: 1 }),
          }),
        },
      )
      // ------------------------------------------------------------------
      // ARC-gated `GET /internal/chats/:chatId/messages` — list messages
      // in a c2b chat (newest first, cursor-paginated via `before` + `limit`).
      // ------------------------------------------------------------------
      .get(
        "/chats/:chatId/messages",
        async ({ headers, params, query, set }) => {
          const caller = await requireArc(headers.authorization, set, AUDIENCE, "chat:c2b");
          if (!caller) return { error: "Unauthorized" };

          const limit = query.limit ? Number(query.limit) : undefined;
          const before = query.before ?? undefined;

          const result = await runtime.runPromise(
            listC2bMessages(params.chatId, { limit, before }).pipe(
              Effect.catchTag("ChatNotFound", () =>
                Effect.sync(() => {
                  set.status = 404;
                  return { error: "Chat not found" } as const;
                }),
              ),
              Effect.catchTag("NotC2bChat", () =>
                Effect.sync(() => {
                  set.status = 409;
                  return { error: "Not a c2b chat" } as const;
                }),
              ),
              Effect.catchTag("DatabaseError", () =>
                Effect.sync(() => {
                  set.status = 500;
                  return { error: "Internal server error" } as const;
                }),
              ),
            ),
          );
          if ("error" in result) return result;
          return {
            messages: result.map((m) => ({
              id: m.id,
              senderProfileId: m.senderProfileId,
              body: m.body ?? "",
              createdAt: m.createdAt.toISOString(),
            })),
          };
        },
        {
          params: t.Object({ chatId: t.String({ minLength: 1 }) }),
          query: t.Object({
            limit: t.Optional(t.String()),
            before: t.Optional(t.String()),
          }),
        },
      )
  );
};
