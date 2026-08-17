import { expect, test } from "bun:test";

import { issueType } from "./issue-type";

test("an item with no area is ordinary product work, so it is a Feature", () => {
  expect(issueType(["product:pulse"])).toBe("Feature");
});

test("a security or performance finding is a Bug", () => {
  expect(issueType(["product:cire", "area:security", "severity:high"])).toBe("Bug");
  expect(issueType(["product:cire", "area:performance", "severity:critical"])).toBe("Bug");
});

test("a finding filed for information asks for no fix, so it is a Task", () => {
  expect(issueType(["product:cire", "area:performance", "severity:info"])).toBe("Task");
  expect(issueType(["product:cire", "area:security", "severity:info"])).toBe("Task");
});

test("compliance, ops and schema rows are Tasks", () => {
  expect(issueType(["product:osn-core", "area:compliance", "severity:high"])).toBe("Task");
  expect(issueType(["product:osn-core", "area:ops"])).toBe("Task");
  expect(issueType(["product:pulse", "area:schema"])).toBe("Task");
});

test("an epic only groups its children, whatever area it carries", () => {
  expect(issueType(["epic", "product:cire"])).toBe("Task");
  expect(issueType(["epic", "product:cire", "area:security"])).toBe("Task");
});
