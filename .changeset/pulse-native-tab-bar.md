---
"@pulse/app": minor
---

Native iOS tab bar, replacing the DOM tabs on device.

A new `tauri-plugin-pulse-tabbar` crate installs a real `UITabBar` as a
subview of the `WKWebView` and keeps it in sync with the router both ways.
The bar's appearance is left untouched, so iOS 26 gives it Liquid Glass by
default — public API only, no `NSGlassEffectView` or other private surface.

The webview keeps its full frame; the bar is accounted for with
`scrollView.contentInset.bottom`, not frame surgery, so nothing is clipped
and rotation is handled by UIKit's own layout pass. The inset is measured as
`height - (adjustedContentInset.bottom - contentInset.bottom)` — a plain
`contentInset.bottom = height` would double-count the safe-area padding that
`contentInsetAdjustmentBehavior` already adds, and that the bar's intrinsic
size already includes.

Selection travels JS→native as a `set_selected_tab` command and native→JS
over a typed Tauri `Channel<TabSelected>`, taken as a top-level command
argument because `Channel` needs the `Webview` to deserialize and cannot be
nested inside a payload struct. The loop does not feed back on itself:
assigning `UITabBar.selectedItem` in code does not call the delegate.

`src/lib/tabs.ts` is now the single source of truth for both sets of tabs, so
the native bar and `ExploreNav` can never drift. `ExploreNav` hides its own
tab row once the native bar reports itself installed. Off iOS the plugin
returns `Unsupported`, the install call rejects, and the DOM tabs stay — no
user-agent sniffing anywhere.

The list is capped at five items: a sixth would make UIKit collapse the
overflow into a "More" tab, which has no route of its own and would break the
two-way sync.

**Not yet verified.** The rotation acceptance test needs `tauri ios dev` on a
simulator. It has not been run — the Rust and Swift both compile for
`aarch64-apple-ios`, and the TypeScript side is covered by unit tests, but no
device or simulator has displayed this bar yet.
