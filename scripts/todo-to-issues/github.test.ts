import { expect, test } from "bun:test";

import { createIssue, linkSubIssue, readIssue, Throttle, updateIssue } from "./github";

test("creates an issue through gh api and returns number and id", async () => {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return { number: 501, id: 99887766 };
  };
  const created = await createIssue(gh, "xchromo/osn", {
    title: "T",
    body: "B",
    labels: ["product:cire", "area:feature"],
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

test("no exported function issues a DELETE", async () => {
  const source = await Bun.file("scripts/todo-to-issues/github.ts").text();
  expect(source).not.toContain("DELETE");
});
