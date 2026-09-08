// `gitBranch` is a property of the session, captured once when it starts and
// inherited by every subagent, so a subagent working in a task worktree records
// the branch its PARENT started on. These tests cover the resolver that reads
// the branch back out of the dispatch prompt instead.
//
// They live in their own file rather than at the end of `pr-metrics.test.ts`
// because #931 appends there; a separate file has no conflict to resolve.

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readRecordsForBranch,
  recordsByBranch,
  resolveDispatchBranch,
  unattributedSubagentFiles,
} from "../index";

/** A sessions tree shaped like `~/.claude/projects`. Returns the root. */
async function tree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pr-metrics-dispatch-"));
  await mkdir(join(dir, "proj/sess-1/subagents"), { recursive: true });
  return dir;
}

/** The parent's assistant record carrying the dispatch. The tool is named
 * `Agent` in real transcripts — never `Task`. */
function dispatch(toolUseId: string, prompt: string, gitBranch = "main"): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "sess-1",
    gitBranch,
    timestamp: "2026-09-08T10:00:00.000Z",
    message: {
      model: "claude-opus-5",
      content: [{ type: "tool_use", id: toolUseId, name: "Agent", input: { prompt } }],
    },
  });
}

test("resolves the branch from a TASK-BRANCH marker in the parent's dispatch prompt", async () => {
  const dir = await tree();
  try {
    const subagent = join(dir, "proj/sess-1/subagents/agent-aaa.jsonl");
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "TASK-BRANCH: feat/x\n\nDo the thing.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ agentType: "general-purpose", toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      subagent,
      `${JSON.stringify({ type: "assistant", gitBranch: "main", isSidechain: true })}\n`,
    );

    expect(resolveDispatchBranch(subagent)).toBe("feat/x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 79 of this machine's 363 subagent transcripts are `spawnDepth: 2`, and every
// one of their parents is a sibling `subagents/*.jsonl` rather than the session
// file. Searching only the session file finds nothing for 8.3% of subagent spend.
test("finds the dispatch in a sibling subagent transcript, not just the session file", async () => {
  const dir = await tree();
  try {
    const child = join(dir, "proj/sess-1/subagents/agent-child.jsonl");
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_parent", "TASK-BRANCH: feat/x\n\nOuter.")}\n`,
    );

    // The depth-1 agent dispatches the depth-2 one; its transcript holds the
    // `tool_use`, and it carries a marker of its own.
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-parent.jsonl"),
      `${dispatch("toolu_child", "TASK-BRANCH: feat/x\n\nInner.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-child.meta.json"),
      JSON.stringify({ agentType: "general-purpose", toolUseId: "toolu_child", spawnDepth: 2 }),
    );
    await writeFile(
      child,
      `${JSON.stringify({ type: "assistant", gitBranch: "main", isSidechain: true })}\n`,
    );

    expect(resolveDispatchBranch(child)).toBe("feat/x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The depth-2 prompts are written by `stress-plan`, `prep-pr` and
// `superpowers:subagent-driven-development` — the last a plugin nobody in this
// repository can edit — so requiring a marker on every dispatch would lose
// their spend for good. A child with no marker inherits the branch of whatever
// dispatched it.
test("a child with no marker inherits the branch of the transcript that dispatched it", async () => {
  const dir = await tree();
  try {
    const child = join(dir, "proj/sess-1/subagents/agent-child.jsonl");
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_parent", "TASK-BRANCH: feat/x\n\nOuter.")}\n`,
    );

    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-parent.meta.json"),
      JSON.stringify({ toolUseId: "toolu_parent", spawnDepth: 1 }),
    );
    // No marker in the inner dispatch — this is the real shape.
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-parent.jsonl"),
      `${dispatch("toolu_child", "Attack the plan at NEW-FEAT.md. Report findings.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-child.meta.json"),
      JSON.stringify({ toolUseId: "toolu_child", spawnDepth: 2 }),
    );
    await writeFile(
      child,
      `${JSON.stringify({ type: "assistant", gitBranch: "main", isSidechain: true })}\n`,
    );

    expect(resolveDispatchBranch(child)).toBe("feat/x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns null when no marker appears anywhere in the chain", async () => {
  const dir = await tree();
  try {
    const subagent = join(dir, "proj/sess-1/subagents/agent-aaa.jsonl");
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "Just do the thing.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      subagent,
      `${JSON.stringify({ type: "assistant", gitBranch: "main", isSidechain: true })}\n`,
    );

    expect(resolveDispatchBranch(subagent)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The reader is where the resolver has to actually bite. Two things break it if
// missed: the cheap `line.includes(branch)` reject drops these lines before the
// parse (they are stamped `main` and carry `feat/x` nowhere), and the equality
// test that follows compares the stamped branch rather than the resolved one.
test("readRecordsForBranch returns subagent records the marker assigns to the branch", async () => {
  const dir = await tree();
  try {
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "TASK-BRANCH: feat/x\n\nGo.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        sessionId: "sess-1",
        gitBranch: "main",
        isSidechain: true,
        requestId: "req-1",
        timestamp: "2026-09-08T10:01:00.000Z",
        message: { model: "claude-opus-5", usage: { output_tokens: 1234 } },
      })}\n`,
    );

    const records = readRecordsForBranch(dir, "feat/x");

    expect(records).toHaveLength(1);
    expect(records[0]?.message?.usage?.output_tokens).toBe(1234);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Claude Code sometimes writes one conversation into two session files: 615 of
// this machine's assistant records, 5.2% of session spend, are present twice.
// The reader has always counted both.
test("readRecordsForBranch counts a record present in two session files once", async () => {
  const dir = await tree();
  try {
    const line = `${JSON.stringify({
      type: "assistant",
      sessionId: "sess-1",
      gitBranch: "feat/x",
      isSidechain: false,
      requestId: "req-dup",
      timestamp: "2026-09-08T10:02:00.000Z",
      message: { model: "claude-opus-5", usage: { output_tokens: 500 } },
    })}\n`;
    await writeFile(join(dir, "proj/sess-1.jsonl"), line);
    await writeFile(join(dir, "proj/sess-2.jsonl"), line);

    expect(readRecordsForBranch(dir, "feat/x")).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// `backfill.ts` had its own reader grouping on `gitBranch`, so a backfilled card
// and a live card disagreed on the same branch. Both now go through this.
test("recordsByBranch groups a marker-resolved subagent file under the marked branch", async () => {
  const dir = await tree();
  try {
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "TASK-BRANCH: feat/x\n\nGo.")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        sessionId: "sess-1",
        gitBranch: "main",
        isSidechain: true,
        requestId: "req-1",
        message: { model: "claude-opus-5", usage: { output_tokens: 99 } },
      })}\n`,
    );

    const byBranch = recordsByBranch(dir);

    expect(byBranch.get("feat/x")).toHaveLength(1);
    // `main` is not a task branch and never gets a card.
    expect(byBranch.has("main")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Nothing enforces the marker — it is a line a skill tells an agent to write.
// So a forgotten one has to be visible, or it silently reproduces the bug this
// whole change exists to fix.
test("counts subagent files that resolve to nothing under a main or HEAD session", async () => {
  const dir = await tree();
  try {
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "No marker here.", "HEAD")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.jsonl"),
      `${JSON.stringify({ type: "assistant", gitBranch: "HEAD", isSidechain: true, requestId: "r1" })}\n`,
    );

    expect(unattributedSubagentFiles(dir)).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a resolved subagent file is not counted as unattributed", async () => {
  const dir = await tree();
  try {
    await writeFile(
      join(dir, "proj/sess-1.jsonl"),
      `${dispatch("toolu_1", "TASK-BRANCH: feat/x\n\nGo.", "HEAD")}\n`,
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.meta.json"),
      JSON.stringify({ toolUseId: "toolu_1", spawnDepth: 1 }),
    );
    await writeFile(
      join(dir, "proj/sess-1/subagents/agent-aaa.jsonl"),
      `${JSON.stringify({ type: "assistant", gitBranch: "HEAD", isSidechain: true, requestId: "r1" })}\n`,
    );

    expect(unattributedSubagentFiles(dir)).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
