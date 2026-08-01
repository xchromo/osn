import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";

/**
 * True once a real `UITabBar` is on screen. The DOM tabs read this and stop
 * rendering, so the two are never both visible.
 */
const [nativeTabBarActive, setNativeTabBarActive] = createSignal(false);
export { nativeTabBarActive };

export type NativeTab = {
  id: string;
  title: string;
  systemImage?: string;
  enabled?: boolean;
};

type TabSelected = { id: string };

/**
 * Installs or replaces the native tab bar, and returns whether it took.
 *
 * There is no platform sniffing here on purpose: the plugin itself reports
 * `Unsupported` everywhere but iOS, so a rejected call is the answer. That
 * also covers an older build of the shell that has no such plugin at all.
 */
export async function installNativeTabBar(
  tabs: NativeTab[],
  selectedId: string | undefined,
  onSelect: (id: string) => void,
): Promise<boolean> {
  if (!isTauri()) return false;

  const channel = new Channel<TabSelected>();
  channel.onmessage = (message) => onSelect(message.id);

  try {
    await invoke("plugin:pulse-tabbar|set_tabs", {
      options: { tabs, selectedId },
      onSelect: channel,
    });
  } catch {
    setNativeTabBarActive(false);
    return false;
  }

  setNativeTabBarActive(true);
  return true;
}

/** Moves the highlight after a route change that did not come from a tap. */
export async function setSelectedNativeTab(id: string): Promise<void> {
  if (!nativeTabBarActive()) return;
  try {
    await invoke("plugin:pulse-tabbar|set_selected_tab", { options: { id } });
  } catch {
    // A route with no tab of its own; leave the highlight where it is.
  }
}

/** Removes the bar and gives the webview its full height back. */
export async function clearNativeTabs(): Promise<void> {
  if (!nativeTabBarActive()) return;
  setNativeTabBarActive(false);
  try {
    await invoke("plugin:pulse-tabbar|set_tabs", {
      options: { tabs: [] },
      onSelect: new Channel<TabSelected>(),
    });
  } catch {
    // Nothing left to do: the bar is either already gone or was never there.
  }
}
