import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { createTestLayer, seedChat, seedMember } from "../helpers/db";
import { sendMessage, listMessages } from "../../src/services/messages";

describe("messages service", () => {
  it.effect("sendMessage stores an encrypted message", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      const msg = yield* sendMessage(chat.id, "usr_alice", {
        ciphertext: "dGVzdCBtZXNzYWdl",
        nonce: "YWJjZGVmMTIzNDU2",
      });
      expect(msg.id).toMatch(/^msg_/);
      expect(msg.chatId).toBe(chat.id);
      expect(msg.senderUserId).toBe("usr_alice");
      expect(msg.ciphertext).toBe("dGVzdCBtZXNzYWdl");
      expect(msg.nonce).toBe("YWJjZGVmMTIzNDU2");
      expect(msg.createdAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("sendMessage fails for non-member", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      const result = yield* Effect.either(
        sendMessage(chat.id, "usr_bob", { ciphertext: "dGVzdA==", nonce: "bm9uY2U=" }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("NotChatMember");
      }
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("sendMessage fails for nonexistent chat", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        sendMessage("chat_nope", "usr_alice", { ciphertext: "dGVzdA==", nonce: "bm9uY2U=" }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ChatNotFound");
      }
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("listMessages returns messages in reverse chronological order", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      yield* sendMessage(chat.id, "usr_alice", {
        ciphertext: "bXNnMQ==",
        nonce: "bm9uY2Ux",
      });
      // Small delay to ensure ordering by createdAt.
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
      yield* sendMessage(chat.id, "usr_alice", {
        ciphertext: "bXNnMg==",
        nonce: "bm9uY2Uy",
      });

      const msgs = yield* listMessages(chat.id, "usr_alice");
      expect(msgs).toHaveLength(2);
      // Newest first.
      expect(msgs[0]!.ciphertext).toBe("bXNnMg==");
      expect(msgs[1]!.ciphertext).toBe("bXNnMQ==");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("listMessages respects limit", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      for (let i = 0; i < 5; i++) {
        yield* sendMessage(chat.id, "usr_alice", {
          ciphertext: `bXNn${i}`,
          nonce: `bm9uY2U${i}`,
        });
      }

      const msgs = yield* listMessages(chat.id, "usr_alice", { limit: 2 });
      expect(msgs).toHaveLength(2);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("listMessages fails for non-member", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      const result = yield* Effect.either(listMessages(chat.id, "usr_bob"));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("NotChatMember");
      }
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("listMessages returns empty for chat with no messages", () =>
    Effect.gen(function* () {
      const chat = yield* seedChat({ type: "group" });
      yield* seedMember(chat.id, "usr_alice", "admin");

      const msgs = yield* listMessages(chat.id, "usr_alice");
      expect(msgs).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer())),
  );
});
