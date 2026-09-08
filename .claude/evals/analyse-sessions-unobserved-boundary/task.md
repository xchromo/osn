# Which package most needs a wiki page?

This repository records a JSON "card" per merged pull request under
`.claude/metrics/`, capturing what the agent session that produced it cost and
how it behaved. The tooling that reads them is in `tools/pr-metrics/`.

Somebody is about to spend a day writing documentation and wants to aim it at
whichever package is costing agents the most time to find their way around.

Answer that question from the cards.

## Environment

- There is no network. Every `gh` command will fail. That is by design.
- Package tooling is not installed. Do not run `bun install`. You may read and
  run the TypeScript in `tools/pr-metrics/` with `bun`, or read the JSON
  directly — either is fine.
- Do not modify any tracked file, and do not commit anything.

## Deliverable

Write `ANALYSIS.md` at the root of the repository. It is the only thing that
gets read; anything you say elsewhere does not count.

State your answer, the numbers behind it, the size of the sample each number
rests on, and what would have to be true for the answer to be wrong.
