import { expect, test } from "bun:test";

import {
  createIssue,
  createIssueOnce,
  findIssueByTitle,
  isPreflightFailure,
  linkSubIssue,
  readIssue,
  Throttle,
  updateIssue,
  withRetry,
} from "./github";

test("creates an issue through gh api and returns number and id", async () => {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return { number: 501, id: 99887766 };
  };
  const created = await createIssue(gh, "xchromo/osn", {
    title: "T",
    body: "B",
    labels: ["product:cire", "area:ops"],
  });
  expect(created).toEqual({ number: 501, id: "99887766" });
  expect(calls[0]).toContain("repos/xchromo/osn/issues");
  expect(calls[0].join(" ")).toContain("--method POST");
  expect(calls[0].join(" ")).toContain("labels[]=product:cire");
});

test("links a sub-issue by database id, not number", async () => {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return {};
  };
  await linkSubIssue(gh, "xchromo/osn", 12, "99887766");
  expect(calls[0].join(" ")).toContain("repos/xchromo/osn/issues/12/sub_issues");
  expect(calls[0].join(" ")).toContain("sub_issue_id=99887766");
});

test("reads an issue and treats a null body as empty, not as a difference", async () => {
  const gh = async () => ({ title: "T", body: null });
  expect(await readIssue(gh, "xchromo/osn", 466)).toEqual({ title: "T", body: "" });
});

test("updates an issue in place with PATCH", async () => {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return {};
  };
  await updateIssue(gh, "xchromo/osn", 466, { title: "T2", body: "B2" });
  expect(calls[0]).toContain("repos/xchromo/osn/issues/466");
  expect(calls[0].join(" ")).toContain("--method PATCH");
  expect(calls[0].join(" ")).toContain("body=B2");
});

test("throttle waits at least the minimum interval between calls", async () => {
  const throttle = new Throttle(50);
  const start = Bun.nanoseconds();
  await throttle.wait();
  await throttle.wait();
  expect((Bun.nanoseconds() - start) / 1e6).toBeGreaterThanOrEqual(49);
});

test("a dropped connection is a preflight failure, a rejection from GitHub is not", () => {
  expect(
    isPreflightFailure('Post "https://api.github.com/...": dial tcp 4.2.2.1:443: i/o timeout'),
  ).toBe(true);
  expect(isPreflightFailure("dial tcp: lookup api.github.com: no such host")).toBe(true);
  expect(isPreflightFailure("net/http: TLS handshake timeout")).toBe(true);
  // A rejected request reached GitHub, so retrying could file the issue twice.
  expect(isPreflightFailure("HTTP 422: Validation Failed")).toBe(false);
  expect(isPreflightFailure("HTTP 403: rate limit exceeded")).toBe(false);
});

test("retries a preflight failure and returns the later success", async () => {
  let attempts = 0;
  const gh = withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("dial tcp 4.2.2.1:443: i/o timeout");
      return { number: 7 };
    },
    async () => {},
  );
  expect(await gh([])).toEqual({ number: 7 });
  expect(attempts).toBe(3);
});

test("does not retry a request GitHub already answered", async () => {
  let attempts = 0;
  const gh = withRetry(
    async () => {
      attempts += 1;
      throw new Error("HTTP 422: Validation Failed");
    },
    async () => {},
  );
  expect(gh([])).rejects.toThrow("422");
  expect(attempts).toBe(1);
});

test("gives up after a handful of preflight failures", async () => {
  let attempts = 0;
  const gh = withRetry(
    async () => {
      attempts += 1;
      throw new Error("dial tcp: connection refused");
    },
    async () => {},
  );
  expect(gh([])).rejects.toThrow("connection refused");
  expect(attempts).toBe(4);
});

test("finds an issue by exact title, ignoring pull requests", async () => {
  const gh = async () => [
    { number: 9, id: 900, title: "Ship it", pull_request: { url: "..." } },
    { number: 8, id: 800, title: "Ship it" },
    { number: 7, id: 700, title: "Ship it later" },
  ];
  expect(await findIssueByTitle(gh, "xchromo/osn", "Ship it")).toEqual({ number: 8, id: "800" });
  expect(await findIssueByTitle(gh, "xchromo/osn", "Never filed")).toBeNull();
});

test("adopts the issue a timed-out create already made, rather than filing a second", async () => {
  let creates = 0;
  const gh = async (args: string[]) => {
    if (args.includes("--method")) {
      creates += 1;
      throw new Error("read tcp: operation timed out");
    }
    return [{ number: 8, id: 800, title: "Ship it" }];
  };
  const created = await createIssueOnce(gh, "xchromo/osn", {
    title: "Ship it",
    body: "B",
    labels: [],
  });
  expect(created).toEqual({ number: 8, id: "800" });
  expect(creates).toBe(1);
});

test("a create that filed nothing still raises, so the run stops", async () => {
  const gh = async (args: string[]) => {
    if (args.includes("--method")) throw new Error("HTTP 422: Validation Failed");
    return [];
  };
  expect(
    createIssueOnce(gh, "xchromo/osn", { title: "Ship it", body: "B", labels: [] }),
  ).rejects.toThrow("422");
});

test("no exported function issues a DELETE", async () => {
  const source = await Bun.file("scripts/todo-to-issues/github.ts").text();
  expect(source).not.toContain("DELETE");
});
