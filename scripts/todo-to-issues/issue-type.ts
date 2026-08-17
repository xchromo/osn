/** The three issue types the xchromo organisation defines. */
export type IssueType = "Bug" | "Feature" | "Task";

/**
 * The GitHub issue type an item's labels imply.
 *
 * Labels say what area an item belongs to; the type says what kind of work it
 * is, and Projects can group and filter on it. Security and performance rows
 * are review findings -- something behaving wrongly -- so they are bugs, with
 * one exception: a finding filed at `severity:info` records an observation and
 * asks for no fix, which is a task at most. Everything else, including the
 * epics that only group their children, is a task.
 */
export function issueType(labels: string[]): IssueType {
  if (labels.includes("epic")) return "Task";
  if (labels.includes("area:feature")) return "Feature";
  const finding = labels.includes("area:security") || labels.includes("area:performance");
  if (finding && !labels.includes("severity:info")) return "Bug";
  return "Task";
}
