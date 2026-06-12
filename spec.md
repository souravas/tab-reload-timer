# Tab Reload Timer — Specification

A simple, modern Chrome extension that automatically reloads tabs on a custom interval. Inspired by [Tab Reloader (page auto refresh)](https://chromewebstore.google.com/detail/tab-reloader-page-auto-re/dejobinhdiimklegodgbmbifijpppopn), but deliberately smaller: we keep the features people actually use daily and drop the power-user edge cases. The goal is an extension you can understand in 5 seconds and configure in 2 clicks.

---

## 1. Product goals

- **Instant**: open the popup, hit Start, done. Sensible defaults everywhere.
- **Per-tab**: every tab gets its own independent reload job and interval.
- **Trustworthy**: jobs survive browser restarts; the badge always tells you what's happening.
- **Modern UI**: clean, compact popup with light/dark support. No settings pages buried three levels deep.

## 2. Feature selection

### ✅ Features we keep (core)

| # | Feature | Why it's in |
|---|---------|-------------|
| 1 | **Per-tab reload timer with custom interval** | The whole point of the extension. Hours / minutes / seconds input plus quick presets (30s, 1m, 2m, 5m, 15m, 30m, 1h). |
| 2 | **Random variation (jitter)** | Signature feature of the original. A single optional "± variation" value (e.g. 60s ± 10s) so reloads don't look robotic. |
| 3 | **Start/stop from the popup** | Toggle the job for the current tab with one switch. |
| 4 | **Active-jobs list in the popup** | See every tab with a running job, its countdown, and jump to or stop any of them — without switching tabs first (improves on the original, which requires you to switch to a tab to disable it). |
| 5 | **Badge countdown** | Toolbar badge shows time remaining until the next reload of the current tab (e.g. `45s`, `3m`). Optional, on by default. |
| 6 | **Restore jobs after restart** | Jobs are persisted and re-attached after a browser restart by matching tab URLs (session manager). |
| 7 | **"Only reload when tab is inactive" option** | Per-job toggle. Most users auto-reload background tabs (dashboards, queues) and don't want the page yanked out from under them while reading. |
| 8 | **Stop after N reloads** | Per-job optional counter ("reload 20 times, then stop"). Small to build, genuinely useful. |
| 9 | **Context menu on the page** | Right-click → "Tab Reload Timer" → start/stop with preset intervals. Quick path that skips the popup. |
| 10 | **Hard reload (bypass cache)** | Per-job toggle. Dashboards and status pages are exactly the pages whose caching defeats auto-reloading; `chrome.tabs.reload(id, { bypassCache: true })` costs nothing. |
| 11 | **Keyboard shortcut** | `Alt+Shift+R` toggles reloading on the current tab with the default interval (rebindable at `chrome://extensions/shortcuts`). On a non-reloadable page the badge flashes `n/a` instead of silently doing nothing. |
| 12 | **Remember last-used config** | The popup pre-fills the interval and options from the last job the user started, so a recurring setup survives popup closes. |
| 13 | **Pause all / stop all** | Bulk controls in the jobs-list header pause/resume or stop every job at once. |
| 14 | **Completion feedback** | When a "stop after N" job finishes, the badge flashes `done` and an opt-in desktop notification fires (`notifications` permission, off by default). |

### ❌ Features we drop (and why)

| Original feature | Reason for dropping |
|------------------|---------------------|
| Run custom JavaScript on each reload | Security risk, requires broad host permissions and `scripting`; niche use. |
| URL/hostname auto-start rules | Adds a whole rules engine + options UI for a small audience. |
| Time/date "do not reload" policies | Same — policy engine complexity for rare use. |
| Scroll to bottom after reload | Niche; needs content-script injection on every page. |
| Bypass form submissions (re-POST) | Confusing and potentially destructive (double-submitting forms). |
| Reload all tabs in window / all windows | One-off action better served by browser shortcuts; not about *scheduled* reloading. |
| Reload discarded tabs | Edge case tied to memory-saver internals. |
| Bulk-apply to all selected tabs | Nice-to-have; revisit later if requested. |

Dropping these keeps permissions minimal (no `scripting`, no `<all_urls>` host permissions) and the UI to a single popup.

## 3. Architecture

### Platform
- **Manifest V3** (required for new Chrome Web Store submissions).
- Background **service worker** owns all scheduling and state. The popup is a thin view over it.
- Vanilla **HTML/CSS/JS** (no framework, no build step). The popup is small enough that a framework adds nothing.

### Permissions (minimal)
- `tabs` — read tab URLs/titles for the jobs list and session restore.
- `alarms` — scheduling that survives service-worker shutdown.
- `storage` — persist jobs and settings.
- `contextMenus` — right-click quick actions.
- `notifications` — opt-in "job finished" alert when a stop-after-N job completes.
- *No host permissions, no `scripting`.* Reloading uses `chrome.tabs.reload()`, which needs none of that.

### Scheduling
- Each job is a `chrome.alarms` alarm keyed by tab ID. Alarms persist across service-worker sleep, which `setTimeout` does not.
- **Minimum interval: 30 seconds** (the `chrome.alarms` floor in current Chrome). The UI enforces this and explains it. This is the one honest tradeoff vs. the original; sub-30s reloading isn't reliable in MV3 anyway.
- Jitter: when an alarm fires, the next alarm is scheduled at `interval ± random(0, variation)`.
- Badge countdown: a single repeating 1-second "tick" alarm runs **only while the popup is closed and at least one job exists for the focused tab**; it updates the badge text. (Cheap: badge updates are throttled to the active tab only.)

### State & persistence
- **Source of truth**: a `jobs` map in `chrome.storage.local`, keyed by tab ID.
- Job shape (conceptual):
  - `tabId`, `url`, `title` — identity + restore matching
  - `intervalSec`, `variationSec` — timing
  - `onlyWhenInactive` (bool), `remainingReloads` (number | null)
  - `nextReloadAt` (epoch ms) — drives countdown display
- **Tab closed** → job deleted automatically (`tabs.onRemoved`).
- **Browser restart** → on startup, stored jobs are matched to open tabs by URL (exact match first, then origin match); matched jobs resume, unmatched jobs are discarded after a grace period.
- Global settings (`badge on/off`, default interval in seconds, finish notification on/off) in `chrome.storage.sync`.
- The last-used popup configuration (`lastConfig`) in `chrome.storage.local`; it pre-fills the form on the next popup open.

## 4. UI design

### Popup (the only surface)

A single ~340px-wide popup, two zones:

```
┌─────────────────────────────────────┐
│  ⟳ Tab Reload Timer              ⚙  │
├─────────────────────────────────────┤
│  THIS TAB                           │
│  github.com/pulls                   │
│                                     │
│  Interval   [ 5 ] m  [ 0 ] s        │
│  10s 30s 1m 5m 15m 30m 1h  (chips)  │
│                                     │
│  ▸ More options                     │
│     ± variation [ 0 ] s             │
│     □ Only reload when inactive     │
│     □ Stop after [   ] reloads      │
│                                     │
│  [        ▶ Start reloading       ] │
├─────────────────────────────────────┤
│  ACTIVE JOBS (2)                    │
│  ● dashboard.io      0:42   ⏸ ✕     │
│  ● queue.dev/board   4:10   ⏸ ✕     │
└─────────────────────────────────────┘
```

- **Top card = current tab.** Big primary Start/Stop button; the state for the tab you're on is never ambiguous. While running, the button becomes "Stop" and a live countdown replaces the interval inputs.
- **Preset chips** for one-click intervals; the custom input is right there for everything else.
- **Advanced options collapsed** behind "More options" so the default view stays minimal.
- **Active jobs list**: favicon, hostname, live countdown, pause/stop controls. Clicking a row focuses that tab.
- **Footer gear** opens a tiny inline settings panel (badge on/off, default interval in seconds, finish notification on/off) — no separate options page.

### Visual direction
- Compact, card-based layout; system font stack; one accent color (e.g. a calm blue/teal) used for the running state and countdowns.
- Automatic **light/dark mode** via `prefers-color-scheme`.
- Running state communicated by color + a subtle pulsing dot, not by walls of text.
- Toolbar icon swaps to an "active" variant when the current tab has a running job; badge shows the countdown.

### Context menu
Right-click on any page → **Tab Reload Timer** →
- Start: 30s / 1m / 5m / 15m / 1h (presets)
- Stop reloading this tab (shown only when a job is running)

## 5. Behaviors & edge cases

- **Tab navigates to a different URL**: job keeps running (interval is tab-bound, not URL-bound); stored `url` is updated so restart-restore stays accurate.
- **Tab closed**: job removed silently (matches original's behavior).
- **"Only when inactive" job on the focused tab**: timer keeps counting, but the reload is deferred until the tab loses focus (fires immediately on blur if overdue).
- **Sleeping/locked machine**: `chrome.alarms` catches up on wake with at most one reload (no burst of queued reloads).
- **Countdown accuracy**: derived from stored `nextReloadAt`, never from a ticking counter in the popup, so reopening the popup always shows the true remaining time.
- **`file://` and `chrome://` pages**: `chrome.tabs.reload()` works on `file://` out of the box; `chrome://` and Web Store pages are not reloadable — the popup shows a friendly "can't reload this page" state instead of a broken Start button.

## 6. Project structure (planned)

```
tab-reload-timer/
├── manifest.json          # MV3 manifest
├── background.js          # service worker: jobs, alarms, badge, context menu, restore
├── popup/
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   └── fonts/             # bundled Spline Sans + Spline Sans Mono (woff2)
├── icons/                 # 16/32/48/128, idle + active variants (generated)
├── store-assets/          # Chrome Web Store listing: description, images (generate.py), publishing answers
├── dist/                  # packaged release zips (gitignored; dev/build.sh)
├── dev/                   # dev tooling, not shipped:
│   ├── make_icons.py      #   regenerates icons/
│   ├── preview.html       #   popup preview in a plain browser tab
│   ├── chrome-stub.js     #   fake chrome.* APIs for the preview (?state=idle|run|paused|waiting|blocked)
│   ├── build.sh           #   packages dist/tab-reload-timer-<version>.zip for the Web Store
│   └── tests/             #   unit tests for background.js (node --test "dev/tests/*.test.js")
├── README.md
├── PRIVACY.md
└── spec.md
```

## 7. Milestones

1. **MVP** — manifest, service worker with start/stop/interval jobs via `chrome.alarms`, minimal popup (current tab card only), badge countdown.
2. **Jobs list & polish** — active-jobs list in popup, pause/stop/jump-to-tab, jitter, only-when-inactive, stop-after-N, dark mode, final visual pass.
3. **Resilience** — session restore after restart, context menu, sleep/wake catch-up handling, edge-case states (non-reloadable pages).

## 8. Out of scope (for now)

Custom JS injection, URL auto-start rules, reload policies, scroll-after-reload, form re-submission, bulk "all tabs" actions, options page, sync of jobs across devices. Any of these can be added later without changing the architecture above.
