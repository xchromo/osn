import { createSignal, type Accessor, type Setter } from "solid-js";

/**
 * Preferences are per-browser and worth keeping across reloads — losing the
 * dark background every time Vite restarts is a papercut you feel forty times
 * an hour. Storage failures (private mode, disabled cookies) degrade to
 * in-memory rather than throwing.
 */
function persistedSignal<T extends string>(key: string, fallback: T): [Accessor<T>, Setter<T>] {
  let initial = fallback;
  try {
    initial = (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    /* no storage — defaults are fine */
  }
  const [get, set] = createSignal<T>(initial);
  const wrapped = ((value: unknown) => {
    const next = set(value as never);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* no storage */
    }
    return next;
  }) as Setter<T>;
  return [get, wrapped];
}

export type Theme = "light" | "dark";
/** Kept in sync with the pre-paint script in index.html. */
export const THEME_KEY = "lab-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const [theme, setThemeSignal] = persistedSignal<Theme>(THEME_KEY, readTheme());

export { theme };

export function setTheme(next: Theme) {
  setThemeSignal(next);
  document.documentElement.classList.toggle("dark", next === "dark");
}

/** Backdrop behind the story. `app` follows the theme's own background. */
export type Backdrop = "app" | "paper" | "ink" | "grid" | "checker";
export const BACKDROPS: Backdrop[] = ["app", "paper", "ink", "grid", "checker"];
export const [backdrop, setBackdrop] = persistedSignal<Backdrop>("lab-backdrop", "app");

/** Preview widths. `full` fills the pane. */
export const VIEWPORTS = {
  full: 0,
  phone: 390,
  tablet: 768,
  laptop: 1280,
} as const;
export type ViewportName = keyof typeof VIEWPORTS;
export const [viewport, setViewport] = persistedSignal<ViewportName>("lab-viewport", "full");

/**
 * The selected story lives in the URL fragment so a reload keeps its place and
 * a link to a specific story can be pasted into a PR.
 */
export function currentHash(): string {
  return decodeURIComponent(location.hash.replace(/^#\/?/, ""));
}

const [hash, setHash] = createSignal(currentHash());
window.addEventListener("hashchange", () => setHash(currentHash()));

export { hash };

export function selectStory(id: string) {
  location.hash = `#/${id}`;
}

/** `?bare` drops the lab chrome — one story, whole window. */
export function isBare(): boolean {
  return new URLSearchParams(location.search).has("bare");
}
