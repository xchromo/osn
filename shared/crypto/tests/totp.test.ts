import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  deriveTotpCode,
  generateTotpSecret,
  totpUri,
  verifyTotpCode,
} from "../src/totp";

/**
 * The seed both RFC 4226 Appendix D and RFC 6238 Appendix B publish their
 * vectors against: the ASCII string "12345678901234567890", 20 bytes.
 */
const RFC_SEED = new TextEncoder().encode("12345678901234567890");

/** RFC 4226 Appendix D, HOTP counters 0 through 9. Six digits, as published. */
const HOTP_VECTORS = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

/**
 * RFC 6238 Appendix B, the SHA-1 rows. The RFC publishes eight digits; this
 * module derives six, and the low six of the published value is exactly that
 * — dynamic truncation yields a 31-bit integer and the code is
 * `truncated % 10**digits`, so `(x % 10**8) % 10**6 === x % 10**6` because
 * 10**6 divides 10**8.
 */
const TOTP_VECTORS = [
  { seconds: 59, eightDigit: "94287082" },
  { seconds: 1_111_111_109, eightDigit: "07081804" },
  { seconds: 1_111_111_111, eightDigit: "14050471" },
  { seconds: 1_234_567_890, eightDigit: "89005924" },
  { seconds: 2_000_000_000, eightDigit: "69279037" },
  { seconds: 20_000_000_000, eightDigit: "65353130" },
];

/** RFC 4648 §10, base32 column. Encoding here is unpadded. */
const BASE32_VECTORS = [
  { plain: "", encoded: "", padded: "" },
  { plain: "f", encoded: "MY", padded: "MY======" },
  { plain: "fo", encoded: "MZXQ", padded: "MZXQ====" },
  { plain: "foo", encoded: "MZXW6", padded: "MZXW6===" },
  { plain: "foob", encoded: "MZXW6YQ", padded: "MZXW6YQ=" },
  { plain: "fooba", encoded: "MZXW6YTB", padded: "MZXW6YTB" },
  { plain: "foobar", encoded: "MZXW6YTBOI", padded: "MZXW6YTBOI======" },
];

/** The RFC seed, base32-encoded — the string an authenticator app receives. */
const RFC_SEED_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const TOTP_STEP_SECONDS = 30;

function counterAt(seconds: number): number {
  return Math.floor(seconds / TOTP_STEP_SECONDS);
}

describe("deriveTotpCode — RFC 4226 Appendix D", () => {
  it.each(HOTP_VECTORS.map((code, counter) => ({ counter, code })))(
    "counter $counter derives $code",
    async ({ counter, code }) => {
      expect(await deriveTotpCode(RFC_SEED, counter)).toBe(code);
    },
  );
});

describe("deriveTotpCode — RFC 6238 Appendix B", () => {
  it.each(TOTP_VECTORS)("t=$seconds derives the low six of $eightDigit", async (vector) => {
    expect(await deriveTotpCode(RFC_SEED, counterAt(vector.seconds))).toBe(
      vector.eightDigit.slice(-6),
    );
  });
});

describe("deriveTotpCode — rejected inputs", () => {
  it("rejects a negative counter rather than wrapping it", async () => {
    await expect(deriveTotpCode(RFC_SEED, -1)).rejects.toThrow(TypeError);
  });

  it("rejects a non-integer counter", async () => {
    await expect(deriveTotpCode(RFC_SEED, 1.5)).rejects.toThrow(TypeError);
  });

  it("rejects a secret below the 128-bit floor", async () => {
    await expect(deriveTotpCode(new Uint8Array(15), 1)).rejects.toThrow(TypeError);
  });

  it("rejects an empty secret", async () => {
    await expect(deriveTotpCode(new Uint8Array(0), 1)).rejects.toThrow(TypeError);
  });
});

describe("base32Encode — RFC 4648 §10", () => {
  it.each(BASE32_VECTORS)('encodes "$plain" as $encoded', ({ plain, encoded }) => {
    expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded);
  });

  it("emits only uppercase alphabet characters and no padding", () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      expect(base32Encode(bytes)).toMatch(/^[A-Z2-7]*$/);
    }
  });
});

describe("base32Decode — RFC 4648 §10", () => {
  it.each(BASE32_VECTORS)('decodes $encoded to "$plain"', ({ plain, encoded }) => {
    expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain);
  });

  it.each(BASE32_VECTORS)('decodes the padded form $padded to "$plain"', ({ plain, padded }) => {
    expect(new TextDecoder().decode(base32Decode(padded))).toBe(plain);
  });

  it("round-trips every byte length from 0 to 40", () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      expect([...base32Decode(base32Encode(bytes))]).toStrictEqual([...bytes]);
    }
  });

  it("accepts lowercase, spaced and padded spellings of the same secret", () => {
    const canonical = [...base32Decode(RFC_SEED_BASE32)];
    expect([...base32Decode(RFC_SEED_BASE32.toLowerCase())]).toStrictEqual(canonical);
    expect([...base32Decode("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ")]).toStrictEqual(canonical);
    expect([...base32Decode(`${RFC_SEED_BASE32}======`)]).toStrictEqual(canonical);
  });

  it.each(["0", "1", "8", "9", "-", "!", "@", "ß", "ſ", "ı"])(
    "rejects %s, which is outside the alphabet",
    (character) => {
      expect(() => base32Decode(`MZXW6YTB${character}`)).toThrow(TypeError);
    },
  );

  it("keeps the rejected input out of the error message", () => {
    let message = "";
    try {
      base32Decode("MZXW6YTB!");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("MZXW6YTB");
    expect(message).not.toContain("!");
  });

  it.each([1, 3, 6])("drops the leftover bits of a %s-character input", (length) => {
    const truncated = RFC_SEED_BASE32.slice(0, length);
    expect(base32Decode(truncated)).toHaveLength(Math.floor((length * 5) / 8));
  });
});

describe("base32 and the code derivation agree", () => {
  it("decodes the published seed encoding back into the Appendix B seed", async () => {
    const decoded = base32Decode(RFC_SEED_BASE32);
    expect([...decoded]).toStrictEqual([...RFC_SEED]);
    expect(await deriveTotpCode(decoded, 1)).toBe("287082");
  });
});

describe("verifyTotpCode — RFC 6238 Appendix B", () => {
  it.each(TOTP_VECTORS)("accepts the published code at t=$seconds", async (vector) => {
    const accepted = await verifyTotpCode({
      secret: RFC_SEED,
      code: vector.eightDigit.slice(-6),
      at: new Date(vector.seconds * 1000),
    });
    expect(accepted).toBe(true);
  });
});

describe("verifyTotpCode — drift window", () => {
  const at = new Date(1_111_111_111 * 1000);
  const counter = counterAt(1_111_111_111);

  it("accepts the previous, current and next step at window 1", async () => {
    for (const offset of [-1, 0, 1]) {
      const code = await deriveTotpCode(RFC_SEED, counter + offset);
      expect(await verifyTotpCode({ secret: RFC_SEED, code, at })).toBe(true);
    }
  });

  it("rejects the steps either side of that window", async () => {
    for (const offset of [-2, 2]) {
      const code = await deriveTotpCode(RFC_SEED, counter + offset);
      expect(await verifyTotpCode({ secret: RFC_SEED, code, at })).toBe(false);
    }
  });

  it("accepts only the current step at window 0", async () => {
    const current = await deriveTotpCode(RFC_SEED, counter);
    const next = await deriveTotpCode(RFC_SEED, counter + 1);
    expect(await verifyTotpCode({ secret: RFC_SEED, code: current, at, window: 0 })).toBe(true);
    expect(await verifyTotpCode({ secret: RFC_SEED, code: next, at, window: 0 })).toBe(false);
  });

  it("clamps a large window rather than deriving unbounded candidates", async () => {
    const inside = await deriveTotpCode(RFC_SEED, counter + 10);
    const outside = await deriveTotpCode(RFC_SEED, counter + 11);
    expect(await verifyTotpCode({ secret: RFC_SEED, code: inside, at, window: 100 })).toBe(true);
    expect(await verifyTotpCode({ secret: RFC_SEED, code: outside, at, window: 100 })).toBe(false);
  });
});

describe("verifyTotpCode — malformed input", () => {
  const at = new Date(1_111_111_111 * 1000);

  it.each(["12345", "1234567", "12a456", "", "12 456", "12345 ", "123456\n", "１２３４５６"])(
    "rejects %j without throwing",
    async (code) => {
      expect(await verifyTotpCode({ secret: RFC_SEED, code, at })).toBe(false);
    },
  );

  it("returns false for an invalid date rather than throwing", async () => {
    const code = await deriveTotpCode(RFC_SEED, counterAt(1_111_111_111));
    expect(await verifyTotpCode({ secret: RFC_SEED, code, at: new Date("not a date") })).toBe(
      false,
    );
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("survives a window of %s", async (window) => {
    const code = await deriveTotpCode(RFC_SEED, counterAt(1_111_111_111));
    const accepted = await verifyTotpCode({ secret: RFC_SEED, code, at, window });
    expect(typeof accepted).toBe("boolean");
  });

  it("returns false for a secret below the 128-bit floor rather than throwing", async () => {
    expect(await verifyTotpCode({ secret: new Uint8Array(15), code: "123456", at })).toBe(false);
  });

  it("returns false for an empty secret rather than throwing", async () => {
    expect(await verifyTotpCode({ secret: new Uint8Array(0), code: "123456", at })).toBe(false);
  });
});

describe("generateTotpSecret", () => {
  it("produces 20 bytes", () => {
    expect(generateTotpSecret()).toHaveLength(20);
  });

  it("produces a fresh secret on each call", () => {
    const seen = new Set(Array.from({ length: 100 }, () => base32Encode(generateTotpSecret())));
    expect(seen.size).toBe(100);
  });
});

describe("totpUri", () => {
  it("carries the secret, the issuer and the algorithm parameters", () => {
    const uri = new URL(totpUri({ secret: RFC_SEED, accountName: "ada", issuer: "OSN" }));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.pathname).toBe("/OSN:ada");
    expect(uri.searchParams.get("secret")).toBe(RFC_SEED_BASE32);
    expect(uri.searchParams.get("issuer")).toBe("OSN");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });

  it("percent-encodes a space, a colon and a non-ASCII character in both fields", () => {
    const raw = totpUri({
      secret: RFC_SEED,
      accountName: "adá lovelace:1",
      issuer: "Musubi Social: ID",
    });

    expect(raw).toContain("otpauth://totp/Musubi%20Social%3A%20ID:ad%C3%A1%20lovelace%3A1?");
    expect(raw).toContain("issuer=Musubi%20Social%3A%20ID");

    const uri = new URL(raw);
    expect(uri.searchParams.get("issuer")).toBe("Musubi Social: ID");
    expect(decodeURIComponent(uri.pathname.slice(1))).toBe("Musubi Social: ID:adá lovelace:1");
  });

  it("emits a secret an authenticator can decode back to the seed", () => {
    const secret = generateTotpSecret();
    const uri = new URL(totpUri({ secret, accountName: "ada", issuer: "OSN" }));
    expect([...base32Decode(uri.searchParams.get("secret") ?? "")]).toStrictEqual([...secret]);
  });
});

describe("the ./totp subpath", () => {
  it("resolves through the package's own exports map", async () => {
    const viaSubpath = await import("@shared/crypto/totp");
    expect(viaSubpath.verifyTotpCode).toBe(verifyTotpCode);
    expect(viaSubpath.deriveTotpCode).toBe(deriveTotpCode);
    expect(viaSubpath.base32Decode).toBe(base32Decode);
  });
});
