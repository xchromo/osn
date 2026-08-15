const WIKILINK = /\[\[([^\]]+)\]\]/g;

export function buildWikiIndex(paths: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const path of paths) {
    const withoutExt = path.replace(/\.md$/, "");
    const bare = withoutExt.split("/").at(-1)!;
    const parent = withoutExt.split("/").slice(-2).join("/");
    if (!index.has(bare)) index.set(bare, path);
    if (!index.has(parent)) index.set(parent, path);
  }
  return index;
}

export function rewriteWikilinks(
  text: string,
  index: Map<string, string>,
  repoUrl: string,
): string {
  return text.replace(WIKILINK, (_match, raw: string) => {
    const target = raw.split("|")[0].trim().replace(/#.*$/, "");
    const path = index.get(target) ?? index.get(target.replace(/\/$/, ""));
    return path ? `[${target}](${repoUrl}/${path})` : `\`${target}\``;
  });
}
