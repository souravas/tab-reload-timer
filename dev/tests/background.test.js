// Unit tests for background.js: jitter, badge formatting, restore matching,
// stop-after-N completion, and the bulk pause/stop controls.
// Run with: node --test dev/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeChrome } = require('./chrome-fake');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8');

const drain = () => new Promise((resolve) => setImmediate(resolve));

// Load background.js in a vm context. Its top-level function declarations
// (jitteredDelaySec, restoreSession, ...) land on the context global, so the
// tests call the real implementations directly. Timer functions are stubbed
// so the badge ticker can't keep the test process alive.
async function boot({ jobs, settings, ...stateOpts } = {}) {
  const fake = makeChrome(stateOpts);
  if (jobs) await fake.chrome.storage.local.set({ jobs });
  if (settings) await fake.chrome.storage.sync.set({ settings });
  const ctx = vm.createContext({
    chrome: fake.chrome,
    console,
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  vm.runInContext(SRC, ctx, { filename: 'background.js' });
  await drain(); // let the boot IIFE settle
  return { fake, ctx };
}

function job(tabId, url, overrides = {}) {
  return {
    tabId,
    windowId: 1,
    url,
    title: url,
    favIconUrl: '',
    intervalSec: 60,
    variationSec: 0,
    onlyWhenInactive: false,
    bypassCache: false,
    remainingReloads: null,
    reloadCount: 0,
    paused: false,
    pendingReload: false,
    createdAt: 0,
    ...overrides,
  };
}

test('jitteredDelaySec', async (t) => {
  const { ctx } = await boot();

  await t.test('no variation gives the exact interval', () => {
    assert.equal(ctx.jitteredDelaySec(job(1, 'https://a.example/', { intervalSec: 300 })), 300);
  });

  await t.test('stays within interval ± variation', () => {
    for (let i = 0; i < 500; i++) {
      const d = ctx.jitteredDelaySec(job(1, 'https://a.example/', { intervalSec: 60, variationSec: 10 }));
      assert.ok(d >= 50 && d <= 70, `out of range: ${d}`);
    }
  });

  await t.test('never dips below the 30s alarm floor', () => {
    for (let i = 0; i < 500; i++) {
      const d = ctx.jitteredDelaySec(job(1, 'https://a.example/', { intervalSec: 30, variationSec: 30 }));
      assert.ok(d >= 30, `below floor: ${d}`);
    }
  });
});

test('formatBadge', async () => {
  const { ctx } = await boot();
  assert.equal(ctx.formatBadge(45_000), '45s');
  assert.equal(ctx.formatBadge(190_000), '3:10');
  assert.equal(ctx.formatBadge(1_200_000), '20m');
  assert.equal(ctx.formatBadge(7_200_000), '2h');
});

test('restoreSession re-attaches by exact URL, then origin; the rest become orphans', async () => {
  const { ctx, fake } = await boot({
    tabs: [
      { id: 11, windowId: 1, url: 'https://a.example/x' },
      { id: 12, windowId: 1, url: 'https://b.example/other' },
    ],
  });
  await fake.chrome.storage.local.set({
    jobs: {
      1: job(1, 'https://a.example/x'),
      2: job(2, 'https://b.example/y'),
      3: job(3, 'https://gone.example/z'),
    },
  });

  await ctx.restoreSession();

  const { jobs } = await fake.chrome.storage.local.get('jobs');
  assert.deepEqual(Object.keys(jobs).sort(), ['11', '12']);
  assert.equal(jobs[11].url, 'https://a.example/x'); // exact match
  assert.equal(jobs[12].url, 'https://b.example/y'); // origin match keeps the stored URL
  assert.ok(fake.alarms.has('job:11'));
  assert.ok(fake.alarms.has('job:12'));

  const { orphans } = await fake.chrome.storage.local.get('orphans');
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].url, 'https://gone.example/z');
  assert.ok(fake.alarms.has('orphans-cleanup'));
});

test('stop-after-N: final reload removes the job, flashes "done", notifies when opted in', async () => {
  const { fake } = await boot({
    tabs: [{ id: 5, windowId: 1, active: false, url: 'https://a.example/x' }],
    jobs: { 5: job(5, 'https://a.example/x', { remainingReloads: 1, reloadCount: 4, nextReloadAt: Date.now() }) },
    settings: { notifyOnComplete: true },
  });

  await fake.chrome.alarms.onAlarm.fire({ name: 'job:5' });
  await drain();

  assert.equal(fake.reloads.length, 1);
  const { jobs } = await fake.chrome.storage.local.get('jobs');
  assert.deepEqual(jobs, {});
  assert.ok(!fake.alarms.has('job:5'));
  assert.ok(fake.badges.some((b) => b.tabId === 5 && b.text === 'done'));
  assert.equal(fake.notifications.length, 1);
  assert.match(fake.notifications[0].message, /a\.example/);
  assert.match(fake.notifications[0].message, /5 times/);
});

test('stop-after-N: no notification without opt-in', async () => {
  const { fake } = await boot({
    tabs: [{ id: 5, windowId: 1, active: false, url: 'https://a.example/x' }],
    jobs: { 5: job(5, 'https://a.example/x', { remainingReloads: 1, nextReloadAt: Date.now() }) },
  });

  await fake.chrome.alarms.onAlarm.fire({ name: 'job:5' });
  await drain();

  assert.ok(fake.badges.some((b) => b.tabId === 5 && b.text === 'done'));
  assert.equal(fake.notifications.length, 0);
});

test('pause all / resume all / stop all', async () => {
  const { ctx, fake } = await boot({
    tabs: [
      { id: 1, windowId: 1, url: 'https://a.example/' },
      { id: 2, windowId: 1, url: 'https://b.example/' },
    ],
    jobs: {
      1: job(1, 'https://a.example/', { nextReloadAt: Date.now() + 60_000 }),
      2: job(2, 'https://b.example/', { nextReloadAt: Date.now() + 60_000 }),
    },
  });

  await ctx.setAllPaused(true);
  let { jobs } = await fake.chrome.storage.local.get('jobs');
  assert.ok(jobs[1].paused && jobs[2].paused);
  assert.ok(!fake.alarms.has('job:1') && !fake.alarms.has('job:2'));

  await ctx.setAllPaused(false);
  ({ jobs } = await fake.chrome.storage.local.get('jobs'));
  assert.ok(!jobs[1].paused && !jobs[2].paused);
  assert.ok(fake.alarms.has('job:1') && fake.alarms.has('job:2'));

  await ctx.stopAllJobs();
  ({ jobs } = await fake.chrome.storage.local.get('jobs'));
  assert.deepEqual(jobs, {});
  assert.ok(!fake.alarms.has('job:1') && !fake.alarms.has('job:2'));
});
