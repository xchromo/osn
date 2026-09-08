#!/usr/bin/env bun
/**
 * Report how many comment lines a branch adds and removes against a base.
 *
 * A number to look at, never a gate. There is no threshold: a cleanup that
 * rewraps a block nets near zero, and joining wrapped lines would game any
 * threshold anyway. What it catches is a branch that calls itself a comment
 * cleanup while growing comment volume, which is otherwise invisible until a
 * human opens the diff and counts by eye.
 *
 * Pass the base explicitly. Resolving it here with `git merge-base` would be
 * wrong whenever the base branch has been force-pushed since this branch was
 * cut: the merge-base then falls back to an older ancestor and the base's own
 * commits land in the count, which is how a branch running -40 once got
 * reported as +85.
 */

const base = process.argv[2];
if (!base) {
  console.error("usage: bun run scripts/comment-delta.ts <base-ref>");
  process.exit(2);
}

const EXTENSIONS = ["*.ts", "*.tsx", "*.mjs", "*.js"];

const diff = new TextDecoder().decode(
  Bun.spawnSync({
    cmd: ["git", "diff", `${base}...HEAD`, "--", ...EXTENSIONS],
    stdout: "pipe",
  }).stdout,
);

/**
 * Whether a diffed source line is comment text.
 *
 * Line-oriented and therefore approximate: a string literal whose continuation
 * line starts with `*` counts, and a commented-out block of code counts as
 * comment. Both are rare enough not to move the figure, and the alternative —
 * parsing every revision of every file — buys precision this does not need.
 */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

let added = 0;
let removed = 0;
let addedComments = 0;
let removedComments = 0;

for (const line of diff.split("\n")) {
  if (line.startsWith("+++") || line.startsWith("---")) continue;
  if (line.startsWith("+")) {
    added++;
    if (isComment(line.slice(1))) addedComments++;
  } else if (line.startsWith("-")) {
    removed++;
    if (isComment(line.slice(1))) removedComments++;
  }
}

const net = addedComments - removedComments;
const sign = net > 0 ? "+" : "";

console.log(`comment lines: +${addedComments} -${removedComments} (net ${sign}${net})`);
console.log(
  `all lines:     +${added} -${removed} (net ${added - removed >= 0 ? "+" : ""}${added - removed})`,
);
if (net > 0) {
  console.log(
    `\nThis branch adds ${net} comment lines. That is not a failure — but if it\n` +
      `is a cleanup branch, check the diff for parentheticals that became paragraphs.`,
  );
}
