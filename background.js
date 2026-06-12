// Tab Reload Timer — service worker.
// Owns all job state. Jobs live in chrome.storage.local under "jobs",
// keyed by tabId. One chrome.alarms alarm per job ("job:<tabId>").

const MIN_INTERVAL_S = 30; // chrome.alarms floor in MV3
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const DONE_BADGE_MS = 12 * 1000; // how long the "done" badge lingers after stop-after-N
const NA_BADGE_MS = 3 * 1000; // how long the "n/a" badge explains a no-op shortcut

const ICONS_IDLE = { 16: 'icons/idle-16.png', 32: 'icons/idle-32.png', 48: 'icons/idle-48.png', 128: 'icons/idle-128.png' };
const ICONS_ACTIVE = { 16: 'icons/active-16.png', 32: 'icons/active-32.png', 48: 'icons/active-48.png', 128: 'icons/active-128.png' };

const MENU_PRESETS = [
  [30, '30 seconds'],
  [60, '1 minute'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [3600, '1 hour'],
];

// ---------------------------------------------------------------- state

async function getJobs() {
  return (await chrome.storage.local.get('jobs')).jobs || {};
}

// Serialize all read-modify-write cycles so concurrent events can't
// clobber each other's storage writes. `fn` mutates the jobs object.
let mutationChain = Promise.resolve();
function withJobs(fn) {
  const run = mutationChain.then(async () => {
    const jobs = await getJobs();
    const result = await fn(jobs);
    await chrome.storage.local.set({ jobs });
    return result;
  });
  mutationChain = run.catch(() => {});
  return run;
}

let settingsCache = null;
async function getSettings() {
  if (!settingsCache) {
    const stored = (await chrome.storage.sync.get('settings')).settings || {};
    settingsCache = { badge: true, defaultIntervalSec: 300, notifyOnComplete: false, ...stored };
  }
  return settingsCache;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'local file';
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || 'this tab';
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settingsCache = null;
    tick();
  }
});

// ---------------------------------------------------------------- scheduling

function jitteredDelaySec(job) {
  const v = job.variationSec || 0;
  const jitter = v ? Math.round((Math.random() * 2 - 1) * v) : 0;
  return Math.max(MIN_INTERVAL_S, job.intervalSec + jitter);
}

function scheduleNext(job) {
  job.nextReloadAt = Date.now() + jitteredDelaySec(job) * 1000;
  chrome.alarms.create(`job:${job.tabId}`, { when: job.nextReloadAt });
}

async function startJob(tab, opts) {
  const job = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || '',
    favIconUrl: tab.favIconUrl || '',
    intervalSec: Math.max(MIN_INTERVAL_S, Math.round(opts.intervalSec) || 300),
    variationSec: Math.max(0, Math.round(opts.variationSec) || 0),
    onlyWhenInactive: !!opts.onlyWhenInactive,
    bypassCache: !!opts.bypassCache,
    remainingReloads: opts.remainingReloads > 0 ? Math.round(opts.remainingReloads) : null,
    reloadCount: 0,
    paused: false,
    pendingReload: false,
    createdAt: Date.now(),
  };
  await withJobs((jobs) => {
    jobs[tab.id] = job;
    scheduleNext(job);
  });
  badgeCache.delete(tab.id);
  applyIcon(tab.id, true);
  ensureTicker();
  updateStopMenu();
  return job;
}

async function stopJob(tabId, { tabGone = false } = {}) {
  await withJobs((jobs) => {
    delete jobs[tabId];
  });
  chrome.alarms.clear(`job:${tabId}`);
  badgeCache.delete(tabId);
  if (!tabGone) {
    applyIcon(tabId, false);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
  updateStopMenu();
  tick();
}

function pauseJob(job) {
  if (job.paused) return;
  job.paused = true;
  job.pausedRemainingMs = Math.max(0, (job.nextReloadAt || Date.now()) - Date.now());
  chrome.alarms.clear(`job:${job.tabId}`);
}

function resumeJob(job) {
  if (!job.paused) return;
  job.paused = false;
  const remainingMs = job.pausedRemainingMs || 0;
  delete job.pausedRemainingMs;
  if (job.pendingReload) {
    // A deferred reload is owed; flushPendingReloads fires it (below).
    job.nextReloadAt = null;
  } else {
    job.nextReloadAt = Date.now() + Math.max(1000, remainingMs);
    chrome.alarms.create(`job:${job.tabId}`, { when: job.nextReloadAt });
  }
}

async function setPaused(tabId, paused) {
  await withJobs((jobs) => {
    const job = jobs[tabId];
    if (job) (paused ? pauseJob : resumeJob)(job);
  });
  flushPendingReloads();
  tick();
}

async function setAllPaused(paused) {
  await withJobs((jobs) => {
    for (const job of Object.values(jobs)) (paused ? pauseJob : resumeJob)(job);
  });
  flushPendingReloads();
  tick();
}

async function stopAllJobs() {
  await withJobs((jobs) => {
    for (const key of Object.keys(jobs)) {
      const tabId = Number(key);
      chrome.alarms.clear(`job:${tabId}`);
      badgeCache.delete(tabId);
      applyIcon(tabId, false);
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      delete jobs[key];
    }
  });
  updateStopMenu();
  tick();
}

async function isTabInForeground(tab) {
  if (!tab.active) return false;
  try {
    const win = await chrome.windows.get(tab.windowId);
    return win.focused;
  } catch {
    return false;
  }
}

async function fireJob(jobs, job) {
  let tab;
  try {
    tab = await chrome.tabs.get(job.tabId);
  } catch {
    delete jobs[job.tabId]; // tab is gone
    chrome.alarms.clear(`job:${job.tabId}`);
    return;
  }
  if (job.onlyWhenInactive && (await isTabInForeground(tab))) {
    // Defer: reload happens the moment the tab loses focus.
    job.pendingReload = true;
    job.nextReloadAt = null;
    return;
  }
  try {
    await chrome.tabs.reload(job.tabId, { bypassCache: !!job.bypassCache });
  } catch {
    delete jobs[job.tabId];
    chrome.alarms.clear(`job:${job.tabId}`);
    return;
  }
  job.pendingReload = false;
  job.reloadCount += 1;
  if (job.remainingReloads != null) {
    job.remainingReloads -= 1;
    if (job.remainingReloads <= 0) {
      delete jobs[job.tabId];
      chrome.alarms.clear(`job:${job.tabId}`);
      announceCompletion(job);
      return;
    }
  }
  scheduleNext(job);
}

// A "stop after N" job hit zero: flash a "done" badge on the tab and,
// if the user opted in, raise a notification.
async function announceCompletion(job) {
  applyIcon(job.tabId, false);
  badgeCache.delete(job.tabId);
  chrome.action.setBadgeBackgroundColor({ tabId: job.tabId, color: '#1d9a5b' }).catch(() => {});
  chrome.action.setBadgeTextColor({ tabId: job.tabId, color: '#ffffff' }).catch(() => {});
  chrome.action.setBadgeText({ tabId: job.tabId, text: 'done' }).catch(() => {});
  setTimeout(async () => {
    const jobs = await getJobs();
    if (!jobs[job.tabId]) chrome.action.setBadgeText({ tabId: job.tabId, text: '' }).catch(() => {});
  }, DONE_BADGE_MS);
  const settings = await getSettings();
  if (!settings.notifyOnComplete) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/idle-128.png',
    title: 'Tab Reload Timer',
    message: `Done: reloaded ${hostOf(job.url)} ${job.reloadCount} time${job.reloadCount === 1 ? '' : 's'}.`,
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'orphans-cleanup') {
    chrome.storage.local.remove('orphans');
    orphansMayExist = false;
    return;
  }
  if (!alarm.name.startsWith('job:')) return;
  const tabId = Number(alarm.name.slice(4));
  await withJobs(async (jobs) => {
    const job = jobs[tabId];
    if (!job || job.paused) return;
    await fireJob(jobs, job);
  });
  updateStopMenu();
  ensureTicker();
});

// Fire deferred "only when inactive" reloads once their tab leaves the foreground.
async function flushPendingReloads() {
  // Cheap pre-check: this runs on every tab switch / focus change, so don't
  // enter a read-modify-write cycle unless a reload is actually owed.
  const snapshot = await getJobs();
  if (!Object.values(snapshot).some((j) => j.pendingReload && !j.paused)) return;
  await withJobs(async (jobs) => {
    for (const job of Object.values(jobs)) {
      if (!job.pendingReload || job.paused) continue;
      let tab;
      try {
        tab = await chrome.tabs.get(job.tabId);
      } catch {
        delete jobs[job.tabId];
        continue;
      }
      if (!(await isTabInForeground(tab))) await fireJob(jobs, job);
    }
  });
}

// ---------------------------------------------------------------- badge + icon

function applyIcon(tabId, active) {
  chrome.action.setIcon({ tabId, path: active ? ICONS_ACTIVE : ICONS_IDLE }).catch(() => {});
}

function formatBadge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

let tickerId = null;

// Last badge/icon state applied per tab. Per-tab action state persists in the
// browser until the tab navigates, so identical re-applies are pure overhead.
// Entries are invalidated on navigation (tabs.onUpdated 'loading'), start/stop.
const badgeCache = new Map();

// A 1s heartbeat: updates the badge countdown and, as a side effect of the
// getJobs() storage read, keeps this service worker alive while jobs are
// running so short alarms fire on time. Stops itself when no jobs remain.
async function tick() {
  const jobs = await getJobs();
  if (Object.keys(jobs).length === 0) {
    stopTicker();
    return;
  }
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return;
  }
  if (!tab) return;
  const job = jobs[tab.id];
  if (!job) return;
  const settings = await getSettings();
  let text, color;
  if (!settings.badge) {
    text = '';
    color = '';
  } else if (job.paused) {
    text = '--';
    color = '#5f6b66';
  } else if (job.pendingReload) {
    text = 'wait';
    color = '#c98a2b';
  } else {
    text = formatBadge((job.nextReloadAt || Date.now()) - Date.now());
    color = '#1d9a5b';
  }
  const state = `active|${text}|${color}`;
  if (badgeCache.get(tab.id) === state) return;
  badgeCache.set(tab.id, state);
  applyIcon(tab.id, true); // navigation resets per-tab icon; re-assert
  if (color) {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color }).catch(() => {});
    chrome.action.setBadgeTextColor({ tabId: tab.id, color: '#ffffff' }).catch(() => {});
  }
  chrome.action.setBadgeText({ tabId: tab.id, text }).catch(() => {});
}

function ensureTicker() {
  if (tickerId == null) tickerId = setInterval(tick, 1000);
  tick();
}

function stopTicker() {
  if (tickerId != null) {
    clearInterval(tickerId);
    tickerId = null;
  }
}

// ---------------------------------------------------------------- context menu

// Only offer the menu on pages chrome.tabs.reload() can actually reload.
const MENU_URLS = ['http://*/*', 'https://*/*', 'file:///*', 'ftp://*/*'];

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    const base = { contexts: ['page', 'frame'], documentUrlPatterns: MENU_URLS };
    chrome.contextMenus.create({ id: 'tr', title: 'Tab Reload Timer', ...base });
    for (const [sec, label] of MENU_PRESETS) {
      chrome.contextMenus.create({ id: `tr-start-${sec}`, parentId: 'tr', title: `Start: every ${label}`, ...base });
    }
    chrome.contextMenus.create({ id: 'tr-sep', parentId: 'tr', type: 'separator', ...base });
    chrome.contextMenus.create({ id: 'tr-stop', parentId: 'tr', title: 'Stop reloading this tab', visible: false, ...base });
  });
}

// Show "Stop" only when the active tab has a job.
async function updateStopMenu() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;
    const jobs = await getJobs();
    chrome.contextMenus.update('tr-stop', { visible: !!jobs[tab.id] }, () => void chrome.runtime.lastError);
  } catch {
    // menus may not exist yet; next event re-syncs
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === 'tr-stop') {
    await stopJob(tab.id);
  } else if (String(info.menuItemId).startsWith('tr-start-')) {
    const intervalSec = Number(String(info.menuItemId).slice('tr-start-'.length));
    await startJob(tab, { intervalSec, variationSec: 0, onlyWhenInactive: false, remainingReloads: null });
  }
});

// ---------------------------------------------------------------- keyboard shortcut

// Toggle reloading on the current tab (default interval) — see manifest "commands".
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-reload') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return;
  if (!/^(https?|file|ftp):/.test(tab.url || tab.pendingUrl || '')) {
    // Page can't be reloaded by extensions — flash "n/a" so the shortcut
    // doesn't appear to silently do nothing.
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#5f6b66' }).catch(() => {});
    chrome.action.setBadgeTextColor({ tabId: tab.id, color: '#ffffff' }).catch(() => {});
    chrome.action.setBadgeText({ tabId: tab.id, text: 'n/a' }).catch(() => {});
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {}), NA_BADGE_MS);
    return;
  }
  const jobs = await getJobs();
  if (jobs[tab.id]) {
    await stopJob(tab.id);
  } else {
    const settings = await getSettings();
    await startJob(tab, { intervalSec: settings.defaultIntervalSec, variationSec: 0, onlyWhenInactive: false, remainingReloads: null });
  }
});

// ---------------------------------------------------------------- tab lifecycle

chrome.tabs.onRemoved.addListener((tabId) => {
  badgeCache.delete(tabId);
  stopJob(tabId, { tabGone: true });
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await withJobs((jobs) => {
    const job = jobs[removedTabId];
    if (!job) return;
    delete jobs[removedTabId];
    chrome.alarms.clear(`job:${removedTabId}`);
    job.tabId = addedTabId;
    jobs[addedTabId] = job;
    if (!job.paused && !job.pendingReload) {
      chrome.alarms.create(`job:${addedTabId}`, { when: job.nextReloadAt || Date.now() + job.intervalSec * 1000 });
    }
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const jobs = await getJobs();
  if (jobs[tabId]) {
    if (changeInfo.status === 'loading') {
      badgeCache.delete(tabId); // navigation reset per-tab badge + icon
      applyIcon(tabId, true);
    }
    if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) {
      await withJobs((j) => {
        const job = j[tabId];
        if (!job) return;
        if (changeInfo.url) job.url = changeInfo.url;
        if (changeInfo.title) job.title = changeInfo.title;
        if (changeInfo.favIconUrl) job.favIconUrl = changeInfo.favIconUrl;
      });
    }
  }
  if (changeInfo.url || changeInfo.status === 'complete') tryAdoptOrphans();
});

chrome.tabs.onActivated.addListener(() => {
  flushPendingReloads();
  updateStopMenu();
  tick();
});

chrome.windows.onFocusChanged.addListener(() => {
  flushPendingReloads();
  updateStopMenu();
  tick();
});

// ---------------------------------------------------------------- session restore

// On browser startup tab ids have changed: re-attach stored jobs to open
// tabs by exact URL, then by origin. Unmatched jobs wait as "orphans" for
// tabs that are still loading, and expire after a grace period.
async function restoreSession() {
  await withJobs(async (jobs) => {
    const old = Object.values(jobs);
    for (const key of Object.keys(jobs)) delete jobs[key];
    if (!old.length) return;
    const tabs = await chrome.tabs.query({});
    const claimed = new Set();
    const matched = new Set();
    for (const pass of ['exact', 'origin']) {
      for (const job of old) {
        if (matched.has(job)) continue;
        const hit = tabs.find((t) => {
          if (claimed.has(t.id)) return false;
          const url = t.url || t.pendingUrl || '';
          if (pass === 'exact') return url === job.url;
          try {
            return new URL(url).origin === new URL(job.url).origin;
          } catch {
            return false;
          }
        });
        if (hit) {
          claimed.add(hit.id);
          matched.add(job);
          const revived = { ...job, tabId: hit.id, windowId: hit.windowId, paused: job.paused, pendingReload: false };
          jobs[hit.id] = revived;
          if (!revived.paused) scheduleNext(revived);
          applyIcon(hit.id, true);
        }
      }
    }
    const orphans = old.filter((j) => !matched.has(j));
    if (orphans.length) {
      await chrome.storage.local.set({ orphans });
      orphansMayExist = true;
      chrome.alarms.create('orphans-cleanup', { when: Date.now() + ORPHAN_TTL_MS });
    } else {
      await chrome.storage.local.remove('orphans');
      orphansMayExist = false;
    }
  });
  ensureTicker();
  updateStopMenu();
}

// Whether storage may hold restore-orphans. Starts true on every worker boot
// so the first tab event re-checks storage; flips false once storage is known
// empty, sparing a storage read on every subsequent tab update.
let orphansMayExist = true;

async function tryAdoptOrphans() {
  if (!orphansMayExist) return;
  const { orphans } = await chrome.storage.local.get('orphans');
  if (!orphans || !orphans.length) {
    orphansMayExist = false;
    return;
  }
  const tabs = await chrome.tabs.query({});
  const jobs = await getJobs();
  const remaining = [];
  for (const orphan of orphans) {
    const hit = tabs.find((t) => !jobs[t.id] && (t.url || '') === orphan.url);
    if (hit) {
      const revived = { ...orphan, tabId: hit.id, windowId: hit.windowId, pendingReload: false };
      await withJobs((j) => {
        j[hit.id] = revived;
        if (!revived.paused) scheduleNext(revived);
      });
      applyIcon(hit.id, true);
    } else {
      remaining.push(orphan);
    }
  }
  if (remaining.length) {
    await chrome.storage.local.set({ orphans: remaining });
  } else {
    await chrome.storage.local.remove('orphans');
    orphansMayExist = false;
  }
  ensureTicker();
}

// ---------------------------------------------------------------- popup API

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'start': {
        const tab = await chrome.tabs.get(msg.tabId);
        return startJob(tab, msg.opts);
      }
      case 'stop':
        return stopJob(msg.tabId);
      case 'pause':
        return setPaused(msg.tabId, true);
      case 'resume':
        return setPaused(msg.tabId, false);
      case 'pauseAll':
        return setAllPaused(true);
      case 'resumeAll':
        return setAllPaused(false);
      case 'stopAll':
        return stopAllJobs();
      case 'reloadNow': {
        await withJobs(async (jobs) => {
          const job = jobs[msg.tabId];
          if (job && !job.paused) await fireJob(jobs, job);
        });
        return tick();
      }
      default:
        return null;
    }
  })().then(sendResponse, () => sendResponse(null));
  return true;
});

// ---------------------------------------------------------------- boot

chrome.runtime.onInstalled.addListener(() => {
  setupMenus();
});

chrome.runtime.onStartup.addListener(() => {
  setupMenus();
  restoreSession();
});

// Service worker (re)started mid-session: resume the heartbeat and make sure
// every running job still has its alarm.
(async () => {
  const jobs = await getJobs();
  const ids = Object.keys(jobs);
  if (!ids.length) return;
  const alarms = await chrome.alarms.getAll();
  const have = new Set(alarms.map((a) => a.name));
  await withJobs((j) => {
    for (const job of Object.values(j)) {
      if (job.paused || job.pendingReload) continue;
      if (!have.has(`job:${job.tabId}`)) scheduleNext(job);
    }
  });
  ensureTicker();
  updateStopMenu();
})();
