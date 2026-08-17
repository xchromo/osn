/** The three issue types the xchromo organisation defines. */
export type IssueType = "Bug" | "Feature" | "Task";

/**
 * The GitHub issue type an item's labels imply.
 *
 * Labels say what area an item belongs to; the type says what kind of work it
 * is, and Projects can group and filter on it. Security and performance rows
 * are review findings -- something behaving wrongly -- so they are bugs, with
 * one exception: a finding filed at `severity:info` records an observation and
 * asks for no fix, which is a task at most. Compliance, ops and schema items
 * are tasks, and so are the epics that only group their children.
 *
 * An item carrying no area at all is ordinary product work, which is what
 * Feature means. That absence is the only signal: there is no `area:feature`
 * label, because it would say a second time what the type already says.
 */
export function issueType(labels: string[]): IssueType {
  if (labels.includes("epic")) return "Task";
  const finding = labels.includes("area:security") || labels.includes("area:performance");
  if (finding && !labels.includes("severity:info")) return "Bug";
  if (labels.some((l) => l.startsWith("area:"))) return "Task";
  return "Feature";
}
