import { Elysia, t } from "elysia";
import { Effect, Layer } from "effect";
import { jwtVerify } from "jose";
import { DbLive, type Db } from "@zap/db/service";
import {
  createChat,
  getChat,
  listChats,
  updateChat,
  addMember,
  removeMember,
  getChatMembers,
} from "../services/chats";
import { sendMessage, listMessages } from "../services/messages";
import { metricAccessDenied } from "../metrics";
import { MAX_CHAT_MEMBERS, MAX_CIPHERTEXT_LENGTH, MAX_NONCE_LENGTH } from "../lib/limits";

const chatTypeEnum = t.Union([t.Literal("dm"), t.Literal("group"), t.Literal("event")]);

/** Extracts verified claims from a Bearer token. Returns null on any failure. */
async function extractClaims(
  authHeader: string | undefined,
  secret: Uint8Array,
): Promise<{ userId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), secret);
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}

const DEFAULT_JWT_SECRET = process.env.OSN_JWT_SECRET ?? "dev-secret-change-in-prod";

export const createChatsRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  jwtSecret: string = DEFAULT_JWT_SECRET,
) => {
  const secretBytes = new TextEncoder().encode(jwtSecret);

  return (
    new Elysia({ prefix: "/chats" })
      // ── List user's chats ─────────────────────────────────────────────
      .get("/", async ({ headers, set }) => {
        const claims = await extractClaims(headers["authorization"], secretBytes);
        if (!claims) {
          set.status = 401;
          return { message: "Unauthorized" } as const;
        }
        const result = await Effect.runPromise(
          listChats(claims.userId).pipe(Effect.provide(dbLayer)),
        );
        return { chats: result };
      })
      // ── Get chat by ID ────────────────────────────────────────────────
      .get(
        "/:id",
        async ({ params, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            getChat(params.id).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            metricAccessDenied("chat", "not_found");
            set.status = 404;
            return { message: "Chat not found" };
          }
          return { chat: result };
        },
        { params: t.Object({ id: t.String() }) },
      )
      // ── Create chat ───────────────────────────────────────────────────
      .post(
        "/",
        async ({ body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            createChat(body, claims.userId).pipe(
              Effect.catchTag("ValidationError", (e) =>
                Effect.sync(() => {
                  set.status = 422;
                  return { error: String(e.cause) } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if ("error" in result) return result;
          set.status = 201;
          return { chat: result };
        },
        {
          body: t.Object({
            type: chatTypeEnum,
            title: t.Optional(t.String()),
            eventId: t.Optional(t.String()),
            memberUserIds: t.Optional(t.Array(t.String(), { maxItems: MAX_CHAT_MEMBERS })),
          }),
        },
      )
      // ── Update chat ───────────────────────────────────────────────────
      .patch(
        "/:id",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            updateChat(params.id, body, claims.userId).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotChatAdmin", () =>
                Effect.sync(() => {
                  set.status = 403;
                  return { message: "Forbidden" } as const;
                }),
              ),
              Effect.catchTag("ValidationError", (e) =>
                Effect.sync(() => {
                  set.status = 422;
                  return { error: String(e.cause) } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          if ("error" in result || "message" in result) return result;
          return { chat: result };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ title: t.Optional(t.String()) }),
        },
      )
      // ── Get members ───────────────────────────────────────────────────
      .get(
        "/:id/members",
        async ({ params, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            getChatMembers(params.id).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          return { members: result };
        },
        { params: t.Object({ id: t.String() }) },
      )
      // ── Add member ────────────────────────────────────────────────────
      .post(
        "/:id/members",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            addMember(params.id, body.userId, claims.userId).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotChatAdmin", () =>
                Effect.sync(() => {
                  set.status = 403;
                  return { message: "Forbidden" } as const;
                }),
              ),
              Effect.catchTag("MemberLimitReached", () =>
                Effect.sync(() => {
                  set.status = 422;
                  return { error: "Member limit reached" } as const;
                }),
              ),
              Effect.catchTag("AlreadyMember", () =>
                Effect.sync(() => {
                  set.status = 409;
                  return { error: "Already a member" } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          if ("error" in result || "message" in result) return result;
          set.status = 201;
          return { member: result };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ userId: t.String() }),
        },
      )
      // ── Remove member ─────────────────────────────────────────────────
      .delete(
        "/:id/members/:userId",
        async ({ params, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            removeMember(params.id, params.userId, claims.userId).pipe(
              Effect.map(() => ({ ok: true }) as const),
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotChatAdmin", () =>
                Effect.sync(() => {
                  set.status = 403;
                  return { message: "Forbidden" } as const;
                }),
              ),
              Effect.catchTag("NotChatMember", () =>
                Effect.sync(() => {
                  set.status = 404;
                  return { message: "Not a member" } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          if ("message" in result) return result;
          set.status = 204;
          return null;
        },
        { params: t.Object({ id: t.String(), userId: t.String() }) },
      )
      // ── Send message ──────────────────────────────────────────────────
      .post(
        "/:id/messages",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            sendMessage(params.id, claims.userId, body).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotChatMember", () =>
                Effect.sync(() => {
                  metricAccessDenied("messages", "not_member");
                  set.status = 403;
                  return { message: "Not a member" } as const;
                }),
              ),
              Effect.catchTag("ValidationError", (e) =>
                Effect.sync(() => {
                  set.status = 422;
                  return { error: String(e.cause) } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          if ("error" in result || "message" in result) return result;
          set.status = 201;
          return { message: result };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            ciphertext: t.String({ maxLength: MAX_CIPHERTEXT_LENGTH }),
            nonce: t.String({ maxLength: MAX_NONCE_LENGTH }),
          }),
        },
      )
      // ── List messages ─────────────────────────────────────────────────
      .get(
        "/:id/messages",
        async ({ params, query, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            listMessages(params.id, claims.userId, {
              limit: query.limit ? Number(query.limit) : undefined,
              cursor: query.cursor,
            }).pipe(
              Effect.catchTag("ChatNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotChatMember", () =>
                Effect.sync(() => {
                  metricAccessDenied("messages", "not_member");
                  set.status = 403;
                  return { message: "Not a member" } as const;
                }),
              ),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Chat not found" };
          }
          if ("message" in result && !Array.isArray(result)) return result;
          return { messages: result };
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({
            limit: t.Optional(t.String()),
            cursor: t.Optional(t.String()),
          }),
        },
      )
  );
};

export const chatsRoutes = createChatsRoutes();
