export type Item = {
  sourceFile: string;
  sourceLine: number;
  section: string;
  subsection: string | null;
  title: string;
  body: string;
};

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Classified = Item & {
  repo: "public" | "private";
  labels: string[];
  findingId: string | null;
  severity: Severity | null;
};

export type ManifestEntry = Classified & {
  issueTitle: string;
  issueBody: string;
  epic: string;
  issueNumber?: number;
  issueId?: string;
};
