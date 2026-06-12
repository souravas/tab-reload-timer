# Privacy Policy — Tab Reload Timer

Tab Reload Timer does not collect, store, transmit, sell, or share any personal information about its users.

## What the extension does

- Reloads browser tabs you choose, on a schedule you set, using Chrome's built-in `chrome.tabs.reload()` API.
- Shows a countdown badge on the toolbar icon and a list of your active reload timers in the popup.
- Remembers your reload timers so they can be re-attached to the same pages after a browser restart.

## Data collection

- No personally identifiable information is collected.
- No browsing history, page content, clicks, keystrokes, location, or credentials are collected, stored, or transmitted.
- No analytics, tracking, advertising, or third-party SDKs are included.
- The extension makes **no network requests of its own** — it never contacts any server.

## Data storage

All data stays on your device, inside Chrome's extension storage:

- **`chrome.storage.local`** holds your active reload timers (the tab's URL, title, favicon URL, interval, and timer state) so they survive service-worker restarts and browser restarts, plus the last-used timer options so the popup can pre-fill them. This data never leaves your browser; timer data is deleted when a timer is stopped or its tab is closed.
- **`chrome.storage.sync`** holds three preferences (badge on/off, default interval, finish notification on/off). If you are signed into Chrome, Chrome itself may sync these settings across your devices — that synchronization is performed by Chrome, governed by Google's privacy policy, and contains no browsing data beyond the preference values.

## Permissions

- **`tabs`** — required to reload tabs, read each tab's URL/title/favicon for the popup's job list, detect pages that cannot be reloaded, and re-attach timers to the right tabs after a browser restart.
- **`alarms`** — required to schedule reloads reliably; Manifest V3 service workers cannot use long-lived timers.
- **`storage`** — required to persist timers and the settings described above.
- **`contextMenus`** — required for the right-click "Tab Reload Timer" quick start/stop menu.
- **`notifications`** — used only for the optional (off by default) desktop notification shown when a "stop after N reloads" timer finishes. The notification contains the page's hostname and the reload count; nothing is transmitted anywhere.

The extension requests **no host permissions**, injects **no content scripts**, and does not request `cookies`, `history`, `webRequest`, `scripting`, `identity`, or any other Chrome API permissions.

## Changes to this policy

If the extension's data practices ever change, this document will be updated and the extension's Chrome Web Store listing will reflect the new disclosures.

## Contact

Questions or concerns: souravas007@gmail.com
