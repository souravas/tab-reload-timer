# Chrome Web Store — Listing & Publishing Answers

Everything to copy-paste into the Developer Dashboard when publishing Tab Reload Timer.

---

## Store listing

### Name (from manifest.json `name`)

```
Tab Reload Timer — Auto Refresh Pages
```

(38 characters — store limit is 75. Covers the search terms "tab", "reload", "timer",
"auto refresh", and "page" without repeating any of them.)

### Summary (max 132 characters — from manifest.json `description`)

```
Auto-reload tabs on a custom interval. Per-tab timers with random variation, badge countdown, and session restore.
```

(115 characters)

### Description

Use the contents of [description.txt](description.txt).

### Category

**Productivity → Workflow & Planning**

### Language

**English**

### Images

| Asset | File |
|---|---|
| Store icon 128×128 | `../icons/idle-128.png` |
| Screenshot 1 (1280×800) | `screenshot-1-hero-1280x800.png` |
| Screenshot 2 (1280×800) | `screenshot-2-jobs-1280x800.png` |
| Screenshot 3 (1280×800) | `screenshot-3-options-1280x800.png` |
| Screenshot 4 (1280×800) | `screenshot-4-howitworks-1280x800.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `promo-marquee-1400x560.png` |

Regenerate with `python3 generate.py`.

---

## Privacy tab

### Single purpose description

```
Tab Reload Timer automatically reloads browser tabs on a user-defined schedule. Every feature — per-tab
timers, interval presets, random variation, the badge countdown, pause/stop controls, the context
menu, the keyboard shortcut, and re-attaching timers after a browser restart — exists solely to
configure, display, or perform those scheduled tab reloads.
```

### Permission justifications

**tabs**

```
Required to (1) read the URL, title, and favicon of tabs that have an active reload timer so the
popup can list them and detect non-reloadable pages (chrome:// and Web Store pages), and (2) match
saved timers back to the right tabs after a browser restart. Tab reloading itself is performed with
chrome.tabs.reload(). No page content is ever read; the extension has no host permissions and no
content scripts.
```

**alarms**

```
Required to schedule reloads. Manifest V3 service workers are suspended between events, so
chrome.alarms is the only reliable way to fire a reload at the user's chosen time. One alarm exists
per active timer.
```

**storage**

```
Required to persist the user's reload timers (chrome.storage.local) so they survive service-worker
suspension and browser restarts, and two preferences — badge on/off and default interval —
(chrome.storage.sync). No browsing data leaves the device; nothing is transmitted to any server.
```

**contextMenus**

```
Required for the right-click "Tab Reload Timer" menu that lets the user start (with preset intervals)
or stop reloading the current page without opening the popup.
```

### Host permission justification

```
None requested. The extension declares no host permissions and no content scripts. Reloading uses
chrome.tabs.reload(), which does not require host access, and the extension makes no network
requests of its own.
```

### Are you using remote code?

**No, I am not using remote code.**

```
All JavaScript is packaged inside the extension. No external scripts, no CDN resources, no eval(),
no WebAssembly, no code fetched at runtime. The extension makes no network requests at all.
```

### What user data do you plan to collect from users now or in the future?

Check **none** of the categories:

- [ ] Personally identifiable information — not collected
- [ ] Health information — not collected
- [ ] Financial and payment information — not collected
- [ ] Authentication information — not collected
- [ ] Personal communications — not collected
- [ ] Location — not collected
- [ ] Web history — not collected
- [ ] User activity — not collected
- [ ] Website content — not collected

Certifications (check all three):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

Note: the user's reload timers (tab URL/title/favicon, interval, timer state) and two preferences
are stored only on-device in chrome.storage and are never transmitted anywhere. This is local
persistence of user settings, not data collection.

### Privacy policy URL

```
https://github.com/souravas/tab-reload-timer/blob/main/PRIVACY.md
```

---

## Distribution

- Visibility: **Public**
- Regions: **All regions**
- Pricing: **Free**

## Package

Upload `dist/tab-reload-timer-<version>.zip`, built with `sh dev/build.sh` (contains only
`manifest.json`, `background.js`, `popup/`, `icons/`).
