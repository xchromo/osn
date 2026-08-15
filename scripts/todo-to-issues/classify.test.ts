import { expect, test } from "bun:test";

import { classify, findingId, severityOf } from "./classify";
import type { Item } from "./types";

const item = (over: Partial<Item>): Item => ({
  sourceFile: "wiki/TODO.md",
  sourceLine: 1,
  section: "Up Next",
  subsection: null,
  title: "placeholder",
  body: "",
  ...over,
});

test("extracts every finding ID shape in the backlogs", () => {
  expect(findingId("S-H1 (client) — Refresh token sent in JSON body")).toBe("S-H1");
  expect(findingId("S-M34 — getClientIp trusts the first hop")).toBe("S-M34");
  expect(findingId("S-H (astro-ssrf) `GHSA-2pvr` — Astro Host-header SSRF")).toBe("S-H");
  expect(findingId("P-W2 — N+1 in listEvents")).toBe("P-W2");
  expect(findingId("C-L7 — retention note missing")).toBe("C-L7");
  expect(findingId("**Dev tier** — one-time setup still open.")).toBeNull();
});

test("maps the finding prefix to a severity", () => {
  expect(severityOf("S-C1")).toBe("critical");
  expect(severityOf("S-H1")).toBe("high");
  expect(severityOf("P-W2")).toBe("high");
  expect(severityOf("S-M34")).toBe("medium");
  expect(severityOf("C-L7")).toBe("low");
  expect(severityOf("P-I3")).toBe("info");
});

test("routes the three backlogs to the private tracker", () => {
  expect(classify(item({ section: "Security Backlog" })).repo).toBe("private");
  expect(classify(item({ section: "Performance Backlog" })).repo).toBe("private");
  expect(classify(item({ section: "Compliance Backlog" })).repo).toBe("private");
  expect(
    classify(item({ sourceFile: "cire/wiki/todo/perf.md", section: "Performance" })).repo,
  ).toBe("private");
});

test("routes planned work to the public repo", () => {
  expect(classify(item({ section: "Zap (`zap/api`)" })).repo).toBe("public");
  expect(classify(item({ section: "Auth Improvements (Copenhagen Book Audit)" })).repo).toBe(
    "public",
  );
});

test("assigns exactly one product label", () => {
  const products = (i: Item) => classify(i).labels.filter((l) => l.startsWith("product:"));
  expect(products(item({ section: "Pulse (`pulse/web`)" }))).toEqual(["product:pulse"]);
  expect(products(item({ section: "Cire Landing (`cire/landing`)" }))).toEqual(["product:cire"]);
  expect(products(item({ section: "Platform" }))).toEqual(["product:shared"]);
  expect(products(item({ section: "Security Backlog", title: "S-L1 (zap) — no alg pin" }))).toEqual(
    ["product:zap"],
  );
  expect(products(item({ section: "Future", title: "Nothing named here" }))).toEqual([
    "product:osn-core",
  ]);
});

test("labels ops work in Up Next as ops, not feature", () => {
  const ops = classify(item({ title: "**Deploy preflight for required secrets** — wrangler" }));
  expect(ops.labels).toContain("area:ops");
  const feat = classify(item({ title: "**Guest list filtering** in the host dashboard" }));
  expect(feat.labels).toContain("area:feature");
});

test("attaches a severity label only to findings", () => {
  const finding = classify(item({ section: "Security Backlog", title: "S-M34 — spoofable hop" }));
  expect(finding.labels).toContain("severity:medium");
  expect(finding.findingId).toBe("S-M34");
  const planned = classify(item({ section: "Platform", title: "Build the vendor portal" }));
  expect(planned.labels.some((l) => l.startsWith("severity:"))).toBe(false);
  expect(planned.severity).toBeNull();
});
