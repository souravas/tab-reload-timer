// Tab Reload Timer popup. Reads job state straight from chrome.storage and
// sends mutations (start/stop/pause/resume) to the service worker.

const MIN_INTERVAL_S = 30;
const $ = (id) => document.getElementById(id);

let currentTab = null;
let jobs = {};
let settings = { badge: true, defaultIntervalSec: 300 };

const reloadable = (url) => /^(https?|file|ftp):/.test(url || '');

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'local file';
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || 'unknown';
  }
}

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtInterval(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ') || '0s';
}

function setFavicon(wrap, url) {
  const img = wrap.querySelector('img');
  img.classList.remove('ok');
  if (url && /^(https?|data):/.test(url)) {
    img.onload = () => img.classList.add('ok');
    img.onerror = () => img.classList.remove('ok');
    img.src = url;
  } else {
    img.removeAttribute('src');
  }
}

// ---------------------------------------------------------------- rendering

function render() {
  const job = currentTab ? jobs[currentTab.id] : null;
  const url = job?.url || currentTab?.url || currentTab?.pendingUrl || '';

  $('curHost').textContent = hostOf(url);
  $('curHost').title = url;
  setFavicon(document.querySelector('#currentCard .favicon-wrap'), currentTab?.favIconUrl || job?.favIconUrl);

  const dot = $('statusDot');
  dot.className = 'status-dot' + (job ? (job.paused ? ' paused' : job.pendingReload ? ' waiting' : ' live') : '');

  $('idleView').hidden = !!job || !reloadable(url);
  $('runView').hidden = !job;
  $('blockedView').hidden = !!job || reloadable(url);

  if (job) renderRun(job);
  renderJobsList();
}

function renderRun(job) {
  const countdown = $('countdown');
  const meta = [];
  meta.push(`every ${fmtInterval(job.intervalSec)}`);
  if (job.variationSec) meta.push(`± ${job.variationSec}s`);
  if (job.bypassCache) meta.push('no-cache');
  if (job.reloadCount) meta.push(`${job.reloadCount} reload${job.reloadCount === 1 ? '' : 's'}`);
  if (job.remainingReloads != null) meta.push(`${job.remainingReloads} left`);
  $('runMeta').textContent = meta.join('  ·  ');

  $('pauseLabel').textContent = job.paused ? 'Resume' : 'Pause';
  $('pauseIcon').innerHTML = job.paused
    ? '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'
    : '<path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';

  countdown.classList.toggle('paused', !!job.paused);
  countdown.classList.toggle('waiting', !!job.pendingReload && !job.paused);
  $('runView').classList.toggle('paused', !!job.paused);
  tickCountdowns();
}

function tickCountdowns() {
  const job = currentTab ? jobs[currentTab.id] : null;
  if (job && !$('runView').hidden) {
    const countdown = $('countdown');
    let remaining;
    if (job.paused) {
      remaining = job.pausedRemainingMs ?? 0;
      countdown.textContent = fmtClock(remaining);
    } else if (job.pendingReload) {
      countdown.textContent = 'Reloads when you leave this tab';
      remaining = 0;
    } else {
      remaining = (job.nextReloadAt || Date.now()) - Date.now();
      countdown.textContent = fmtClock(remaining);
    }
    const cycle = job.intervalSec * 1000;
    const progress = Math.min(1, Math.max(0, 1 - remaining / cycle));
    $('sweep').style.width = `${(progress * 100).toFixed(1)}%`;
  }
  for (const row of document.querySelectorAll('.job-row')) {
    const j = jobs[row.dataset.tabId];
    if (!j) continue;
    const t = row.querySelector('.job-time');
    if (j.paused) {
      t.textContent = 'paused';
      t.className = 'job-time paused';
    } else if (j.pendingReload) {
      t.textContent = 'waiting';
      t.className = 'job-time waiting';
    } else {
      t.textContent = fmtClock((j.nextReloadAt || Date.now()) - Date.now());
      t.className = 'job-time';
    }
  }
}

function renderJobsList() {
  const list = $('jobsList');
  const others = Object.values(jobs).filter((j) => j.tabId !== currentTab?.id);
  $('jobsSection').hidden = others.length === 0;
  $('jobCount').textContent = others.length;
  list.textContent = '';
  for (const job of others) {
    const li = document.createElement('li');
    li.className = 'job-row';
    li.dataset.tabId = job.tabId;
    li.title = job.url;
    li.innerHTML = `
      <span class="favicon-wrap"><img alt=""><svg class="favicon-fallback" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17-2.6-2.4-2.6-14.6 0-17z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span>
      <span class="job-host"></span>
      <span class="job-time"></span>
      <button class="mini-btn pause" title="Pause / resume"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
      <button class="mini-btn stop" title="Stop job"><svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor"/></svg></button>`;
    li.querySelector('.job-host').textContent = hostOf(job.url);
    setFavicon(li.querySelector('.favicon-wrap'), job.favIconUrl);
    li.querySelector('.pause').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: job.paused ? 'resume' : 'pause', tabId: job.tabId });
    });
    li.querySelector('.stop').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'stop', tabId: job.tabId });
    });
    li.addEventListener('click', async () => {
      await chrome.tabs.update(job.tabId, { active: true });
      if (job.windowId != null) await chrome.windows.update(job.windowId, { focused: true });
      window.close();
    });
    list.appendChild(li);
  }
  tickCountdowns();
}

// ---------------------------------------------------------------- idle form

function intervalFromInputs() {
  return (Number($('inH').value) || 0) * 3600 + (Number($('inM').value) || 0) * 60 + (Number($('inS').value) || 0);
}

function setInputsFromSec(sec) {
  $('inH').value = Math.floor(sec / 3600);
  $('inM').value = Math.floor((sec % 3600) / 60);
  $('inS').value = sec % 60;
  syncChips();
}

function syncChips() {
  const sec = intervalFromInputs();
  for (const b of $('chips').querySelectorAll('button')) {
    b.classList.toggle('sel', Number(b.dataset.sec) === sec);
  }
}

async function start() {
  const intervalSec = intervalFromInputs();
  if (intervalSec < MIN_INTERVAL_S) {
    $('minNote').hidden = false;
    return;
  }
  $('minNote').hidden = true;
  const opts = {
    intervalSec,
    variationSec: Number($('inVar').value) || 0,
    onlyWhenInactive: $('inInactive').checked,
    bypassCache: $('inCache').checked,
    remainingReloads: Number($('inLimit').value) || null,
  };
  const job = await chrome.runtime.sendMessage({ type: 'start', tabId: currentTab.id, opts });
  if (job) {
    jobs[currentTab.id] = job;
    render();
  }
}

// ---------------------------------------------------------------- settings

function renderSettings() {
  $('setBadge').checked = !!settings.badge;
  $('setDefaultMin').value = Math.max(1, Math.round(settings.defaultIntervalSec / 60));
}

async function saveSettings() {
  settings.badge = $('setBadge').checked;
  settings.defaultIntervalSec = Math.max(1, Number($('setDefaultMin').value) || 5) * 60;
  await chrome.storage.sync.set({ settings });
}

// ---------------------------------------------------------------- boot

async function init() {
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ jobs: storedJobs }, { settings: storedSettings }] = await Promise.all([
    chrome.storage.local.get('jobs'),
    chrome.storage.sync.get('settings'),
  ]);
  jobs = storedJobs || {};
  settings = { ...settings, ...(storedSettings || {}) };

  if (!jobs[currentTab?.id]) setInputsFromSec(settings.defaultIntervalSec);
  renderSettings();
  render();

  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stop', tabId: currentTab.id }));
  $('nowBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reloadNow', tabId: currentTab.id }));
  $('pauseBtn').addEventListener('click', () => {
    const job = jobs[currentTab.id];
    if (job) chrome.runtime.sendMessage({ type: job.paused ? 'resume' : 'pause', tabId: currentTab.id });
  });

  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sec]');
    if (b) {
      setInputsFromSec(Number(b.dataset.sec));
      $('minNote').hidden = true;
    }
  });
  for (const id of ['inH', 'inM', 'inS']) $(id).addEventListener('input', syncChips);

  $('settingsBtn').addEventListener('click', () => {
    $('settingsPanel').hidden = !$('settingsPanel').hidden;
  });
  $('setBadge').addEventListener('change', saveSettings);
  $('setDefaultMin').addEventListener('change', saveSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.jobs) {
      jobs = changes.jobs.newValue || {};
      render();
    }
  });

  setInterval(tickCountdowns, 250);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
