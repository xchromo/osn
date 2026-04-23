import { Effect } from "effect";
import { describe, it, expect } from "vitest";

import { makeLogEmailLive } from "../src/log";
import { EmailService } from "../src/service";

describe("LogEmailLive", () => {
  it("records the rendered payload without sending", async () => {
    const { layer, recorded } = makeLogEmailLive();

    await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        yield* email.send({
          template: "otp-registration",
          to: "alice@example.com",
          data: { code: "111111", ttlMinutes: 10 },
        });
      }).pipe(Effect.provide(layer)),
    );

    const sent = recorded();
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("otp-registration");
    expect(sent[0].to).toBe("alice@example.com");
    expect(sent[0].subject).toBe("Verify your OSN email");
    expect(sent[0].text).toContain("111111");
  });

  it("isolates captures between instances", async () => {
    const a = makeLogEmailLive();
    const b = makeLogEmailLive();

    await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        yield* email.send({
          template: "passkey-added",
          to: "a@example.com",
          data: {},
        });
      }).pipe(Effect.provide(a.layer)),
    );

    expect(a.recorded()).toHaveLength(1);
    expect(b.recorded()).toHaveLength(0);
  });

  it("reset() clears the captured ring", async () => {
    const { layer, recorded, reset } = makeLogEmailLive();
    await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        yield* email.send({
          template: "recovery-generated",
          to: "x@example.com",
          data: {},
        });
      }).pipe(Effect.provide(layer)),
    );
    expect(recorded()).toHaveLength(1);
    reset();
    expect(recorded()).toHaveLength(0);
  });
});
