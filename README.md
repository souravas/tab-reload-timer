# Tab Reload Timer

Chrome extension that automatically reloads tabs on a custom interval. Listed on the Web Store as **Tab Reload Timer — Auto Refresh Pages**. Per-tab timers with random variation, badge countdown, hard reload, and session restore — in a popup you can understand in 5 seconds and configure in 2 clicks.

## Features

- **Per-tab timers** — every tab gets its own independent reload job and interval (hours/minutes/seconds, plus one-click presets from 30s to 1h).
- **Random variation (jitter)** — optional `± N seconds` so reloads don't look robotic.
- **Badge countdown** — the toolbar badge shows time remaining until the next reload of the current tab (`45s`, `3:10`, `12m`, `2h`).
- **Active-jobs list** — see every tab with a running job, its live countdown, and pause/stop/jump-to-tab without leaving the popup.
- **Only reload when inactive** — defer the reload while you're looking at the tab; it fires the moment you switch away.
- **Hard reload** — optionally bypass the HTTP cache on every reload (`chrome.tabs.reload(…, { bypassCache: true })`).
- **Stop after N reloads** — "reload 20 times, then stop."
- **Session restore** — jobs survive browser restarts; they're re-attached to open tabs by URL (exact match first, then origin).
- **Context menu** — right-click → Tab Reload Timer → start with a preset / stop.
- **Keyboard shortcut** — `Alt+Shift+R` toggles reloading on the current tab with your default interval (rebindable at `chrome://extensions/shortcuts`).
- **Light/dark UI** — follows your system theme automatically.

## Install

From source (until the Web Store listing is live):

1. Clone this repository
2. Open `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked** and select the repository folder

## How it works

A Manifest V3 service worker ([background.js](background.js)) owns all state:

1. Jobs live in `chrome.storage.local` under `jobs`, keyed by tab id; each job has one `chrome.alarms` alarm (`job:<tabId>`), so schedules survive service-worker sleep.
2. When an alarm fires, the tab is reloaded (optionally bypassing the cache) and the next alarm is scheduled at `interval ± random(0, variation)`.
3. "Only when inactive" jobs that come due while focused are deferred and fire on `tabs.onActivated` / `windows.onFocusChanged`.
4. While at least one job is running, a 1-second heartbeat updates the badge countdown for the focused tab (redundant badge writes are skipped).
5. On browser startup, stored jobs are matched back to open tabs by exact URL, then origin; unmatched jobs wait as "orphans" for late-loading tabs and expire after a grace period.

The popup ([popup/popup.js](popup/popup.js)) is a thin view: it reads job state from storage and sends start/stop/pause/resume messages to the worker.

**Minimum interval is 30 seconds** — the `chrome.alarms` floor in Manifest V3. The UI enforces and explains this.

## Permissions

- `tabs` — reload tabs, read URL/title/favicon for the jobs list, restore sessions
- `alarms` — scheduling that survives service-worker shutdown
- `storage` — persist jobs (local) and settings (sync)
- `contextMenus` — right-click quick actions

No host permissions, no content scripts, no remote code, no network requests. See [PRIVACY.md](PRIVACY.md).

## Files

```
manifest.json           MV3 manifest
background.js           Service worker: jobs, alarms, badge, context menu, session restore
popup/                  Toolbar popup (HTML/CSS/JS, bundled Spline Sans fonts)
icons/                  Toolbar icons, idle + active variants (dev/make_icons.py)
store-assets/           Chrome Web Store listing: description, publishing answers, images (generate.py)
dev/                    Dev tooling (not shipped): icon generator, popup preview, build script
spec.md                 Design spec
```

## Development

```sh
python3 dev/make_icons.py        # regenerate icons/
open dev/preview.html            # preview the popup in a plain tab (?state=idle|run|paused|waiting|blocked)
python3 store-assets/generate.py # regenerate store listing images
sh dev/build.sh                  # package dist/tab-reload-timer-<version>.zip for the Web Store
```

## License

[MIT](LICENSE)
