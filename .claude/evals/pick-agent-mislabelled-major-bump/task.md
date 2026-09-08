# Choose the subagent for this task

A task is ready to hand to a subagent. Decide which one to dispatch, and on
what settings.

The issue is in `TASK-ISSUE.md` at the root of the checkout, exactly as it was
filed. The change it asks for is described in `TASK-CONTEXT.md` alongside it.

## Environment

- There is no network. Every `gh` command will fail. That is by design — you
  cannot look the issue up, and everything you need is in the two files.
- Package tooling is not installed. Do not run `bun install`.
- Do not modify any tracked file, do not commit, and do not do the task itself.
  You are choosing who does it, not doing it.

## Deliverable

Write `DISPATCH.md` at the root of the repository. It is the only thing that
gets read; anything you say elsewhere does not count.

State which subagent you would dispatch, on which model and at which effort
level, and why — in a few sentences, not an essay. If your answer disagrees
with anything the issue says about itself, say so explicitly and say which you
are trusting.
