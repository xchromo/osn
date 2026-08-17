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

/**
 * Whether a failure happened before the request reached GitHub.
 *
 * A run is hundreds of calls long and one dropped connection should not end
 * it. But a POST that failed *after* GitHub saw it may have created the issue
 * anyway, and retrying that would file a duplicate. So only the failures that
 * name the connection itself count -- DNS, dial, handshake. Anything else is
 * raised and the run stops, which is what the resumable state file is for.
 */
export function isPreflightFailure(message: string): boolean {
  return /dial tcp|no such host|connection refused|connection reset by peer|TLS handshake timeout|EOF$/i.test(
    message,
  );
}

const rawGhApi = async (args: string[]): Promise<unknown> => {
  const proc = Bun.spawn(["gh", "api", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh api failed (${code}): ${err.trim()}`);
  return out.trim() === "" ? {} : JSON.parse(out);
};

/** Retry a preflight failure a few times, backing off. */
export function withRetry(inner: Gh, sleep: (ms: number) => Promise<void> = Bun.sleep): Gh {
  return async (args) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await inner(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 3 || !isPreflightFailure(message)) throw error;
        await sleep(2_000 * 2 ** attempt);
      }
    }
  };
}

export const ghApi: Gh = withRetry(rawGhApi);

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

/**
 * The most recent issue in the repo with this exact title, if there is one.
 *
 * The listing endpoint answers newest-first and also returns pull requests,
 * which carry a `pull_request` key and are not issues for our purposes.
 */
export async function findIssueByTitle(
  gh: Gh,
  repo: string,
  title: string,
): Promise<Created | null> {
  const result = (await gh([`repos/${repo}/issues?state=all&per_page=100`])) as {
    number: number;
    id: number;
    title: string;
    pull_request?: unknown;
  }[];
  const match = result.find((issue) => !issue.pull_request && issue.title === title);
  return match ? { number: match.number, id: String(match.id) } : null;
}

/**
 * Create an issue, or adopt the one a failed attempt already created.
 *
 * A POST can time out on the read after GitHub has accepted it, so the issue
 * exists but the run never learned its number. Retrying blindly would file a
 * duplicate; instead the repo is asked whether the issue is already there. A
 * failure that created nothing -- a 422, a rate-limit 403 -- finds no match
 * and is raised, which stops the run as before.
 */
export async function createIssueOnce(
  gh: Gh,
  repo: string,
  entry: { title: string; body: string; labels: string[] },
): Promise<Created> {
  try {
    return await createIssue(gh, repo, entry);
  } catch (error) {
    const existing = await findIssueByTitle(gh, repo, entry.title);
    if (!existing) throw error;
    return existing;
  }
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
