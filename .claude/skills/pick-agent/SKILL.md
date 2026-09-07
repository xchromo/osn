---
name: pick-agent
description: Use when dispatching a subagent and choosing which one — mapping a task and its declared complexity to an agent definition, and so to a model and an effort level. Invoked by orchestrate at every dispatch site; also the answer to "should this run on a cheaper model".
---

Choose the agent definition for `$ARGUMENTS`. If it is empty, ask what the task
is and what its issue's `complexity:` label says.

## What this run must produce

One name from `.claude/agents/`, and one sentence saying why. Not a paragraph
weighing the options — the caller is about to dispatch and wants a decision.

If the task does not fit any definition, say so and default to `implementer`.
Defaulting up is cheap and recoverable; defaulting down produces a subagent that
quietly does a worse job and reports success.

## Read this before you trust the rubric below

**There is no evidence behind the effort levels yet.** Across every transcript
in this repository — 39,047 assistant records — the effort level is `high`,
every time, without exception. Nothing has ever run at `low`, `medium`, `xhigh`
or `max` here, so no measurement can say what those settings are worth on this
codebase.

The rubric is therefore reasoning, not data. It comes from the documented
behaviour of the levels and from what the session cards show tasks actually
cost, and it will be wrong in places. Two consequences:

- **Say when you are guessing.** A caller that knows the recommendation is a
  prior treats it differently from one that thinks it is a measurement.
- **This skill creates the evidence that will correct it.** Every card records
  `spend.effort` and `spend.by_model`. Once dispatches start varying, run
  `analyse-sessions` and let it argue with what is written here. Expect that to
  happen; the numbers below are a starting position, not a settlement.

## The rubric

Match on what the task *demands*, never on how large the diff will be. A
one-line fix to a race condition is not mechanical work.

| Definition | model · effort | Give it |
|---|---|---|
| `implementer` | opus · xhigh | Anything that designs something. New behaviour, a schema change, a major version bump, auth or session work, a bug whose cause is unknown. The default. |
| `mechanic` | sonnet · medium | Work whose answer is fixed before it starts: patch and minor dependency sweeps, renames, changesets, a known pattern applied across files. |
| `explorer` | sonnet · low | Read-only orientation. Returns `file:line`, proposes nothing. |
| `shepherd` | haiku · low | Polling a pull request to a terminal state. |
| `attacker` | fable · high | Attacking a plan, cold. A different model on purpose. |

Where the issue carries a `complexity:` label, use it — it was set before work
started, which is exactly why it is worth something:

| Declared | Usually |
|---|---|
| 1–2 | `mechanic`, unless the cause is unknown |
| 3 | `implementer` |
| 5–8 | `implementer`, and consider splitting the task before dispatching at all |

## Three traps

**A small change is not a mechanical change.** The `mechanic` definition exists
for work where the answer is already decided. A major version bump produces two
changed lines and needs every breaking change read and applied deliberately —
that is an `implementer`. Nine of the twelve dependency pull requests in this
repository's history contained a major bump, and the cheap ones were cheap
because they were isolated, not because they were mechanical.

**Never choose by cost.** The question is what the task needs, not what it would
be nice to pay. A cheaper agent that does the job worse costs more, because the
work comes back. Downgrade only where the task genuinely does not need the
capability — which the rubric above is an attempt to name.

**One task, one agent.** Two agents writing code in the same worktree corrupt
each other's branches. If work must run in parallel, give each its own worktree
— `CLAUDE.md` says so and it has already cost this repository a lost task.

## What consumes this

`orchestrate` at every dispatch site, `stress-plan` for its cold reader. The
definitions themselves are `.claude/agents/*.md`, and their frontmatter is the
only place per-task effort can be set — the dispatch call carries `model` but
has no `effort` parameter, so a definition is not a convenience here, it is the
mechanism.
