export type Created = { number: number; id: string };
export type Gh = (args: string[]) => Promise<unknown>;

export class Throttle {
  #last = 0;
  constructor(private readonly minIntervalMs: number) {}
  async wait(): Promise<void> {
    const elapsed = Date.now() - this.#last;
    if (this.#last > 0 && elapsed < this.minIntervalMs) {
      await Bun.sleep(this.minIntervalMs - elapsed);
    }
    this.#last = Date.now();
  }
}

export const ghApi: Gh = async (args) => {
  const proc = Bun.spawn(["gh", "api", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh api failed (${code}): ${err.trim()}`);
  return out.trim() === "" ? {} : JSON.parse(out);
};

export async function createIssue(
  gh: Gh,
  repo: string,
  entry: { title: string; body: string; labels: string[] },
): Promise<Created> {
  const args = [
    `repos/${repo}/issues`,
    "--method",
    "POST",
    "-f",
    `title=${entry.title}`,
    "-f",
    `body=${entry.body}`,
    ...entry.labels.flatMap((label) => ["-f", `labels[]=${label}`]),
  ];
  const result = (await gh(args)) as { number: number; id: number };
  return { number: result.number, id: String(result.id) };
}

export async function readIssue(
  gh: Gh,
  repo: string,
  number: number,
): Promise<{ title: string; body: string }> {
  const result = (await gh([`repos/${repo}/issues/${number}`])) as {
    title: string;
    body: string | null;
  };
  return { title: result.title, body: result.body ?? "" };
}

export async function updateIssue(
  gh: Gh,
  repo: string,
  number: number,
  entry: { title: string; body: string },
): Promise<void> {
  await gh([
    `repos/${repo}/issues/${number}`,
    "--method",
    "PATCH",
    "-f",
    `title=${entry.title}`,
    "-f",
    `body=${entry.body}`,
  ]);
}

export async function linkSubIssue(
  gh: Gh,
  repo: string,
  parent: number,
  childId: string,
): Promise<void> {
  await gh([
    `repos/${repo}/issues/${parent}/sub_issues`,
    "--method",
    "POST",
    "-F",
    `sub_issue_id=${childId}`,
  ]);
}
