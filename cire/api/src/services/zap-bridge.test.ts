import { describe, it, expect } from "bun:test";

import { generateKeyPair, exportJWK } from "jose";

import { createZapChatClient } from "./zap-bridge";

async function testKey() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return privateKey;
}

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("zap-bridge createZapChatClient", () => {
  it("provisionC2bChat POSTs to /internal/chats with an ARC header + returns chatId", async () => {
    const { impl, calls } = fakeFetch(201, { chatId: "cht_123" });
    const client = createZapChatClient({
      zapApiUrl: "https://zap.example/",
      arcPrivateKey: await testKey(),
      arcKeyId: "kid_test",
      fetchImpl: impl,
    });
    const res = await client.provisionC2bChat({
      memberProfileIds: ["usr_a", "usr_b"],
      createdByProfileId: "usr_a",
      title: "Vendor ↔ Wedding",
    });
    expect(res.chatId).toBe("cht_123");
    expect(calls[0].url).toBe("https://zap.example/internal/chats");
    const auth = new Headers(calls[0].init?.headers).get("authorization") ?? "";
    expect(auth.startsWith("ARC ")).toBe(true);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({
      class: "c2b",
      memberProfileIds: ["usr_a", "usr_b"],
      createdByProfileId: "usr_a",
      title: "Vendor ↔ Wedding",
    });
  });

  it("sendC2bMessage POSTs the body + returns messageId/createdAt", async () => {
    const { impl, calls } = fakeFetch(201, { messageId: "msg_9", createdAt: 1700 });
    const client = createZapChatClient({
      zapApiUrl: "https://zap.example",
      arcPrivateKey: await testKey(),
      arcKeyId: "kid_test",
      fetchImpl: impl,
    });
    const res = await client.sendC2bMessage("cht_123", { senderProfileId: "usr_a", body: "hi" });
    expect(res).toEqual({ messageId: "msg_9", createdAt: 1700 });
    expect(calls[0].url).toBe("https://zap.example/internal/chats/cht_123/messages");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      senderProfileId: "usr_a",
      body: "hi",
    });
  });

  it("listC2bMessages GETs with limit/before query + returns messages", async () => {
    const { impl, calls } = fakeFetch(200, {
      messages: [{ id: "m1", senderProfileId: "usr_a", body: "hi", createdAt: 1 }],
    });
    const client = createZapChatClient({
      zapApiUrl: "https://zap.example",
      arcPrivateKey: await testKey(),
      arcKeyId: "kid_test",
      fetchImpl: impl,
    });
    const res = await client.listC2bMessages("cht_123", { limit: 20, before: 999 });
    expect(res.messages).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://zap.example/internal/chats/cht_123/messages?limit=20&before=999",
    );
  });

  it("throws on a non-2xx zap response", async () => {
    const { impl } = fakeFetch(500, { error: "boom" });
    const client = createZapChatClient({
      zapApiUrl: "https://zap.example",
      arcPrivateKey: await testKey(),
      arcKeyId: "kid_test",
      fetchImpl: impl,
    });
    await expect(
      client.provisionC2bChat({ memberProfileIds: ["a", "b"], createdByProfileId: "a" }),
    ).rejects.toThrow();
  });
});
