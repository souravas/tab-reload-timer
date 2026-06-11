// Browser-API stub so popup.html can be previewed in a plain browser tab
// (dev/preview.html). Scenario picked via ?state=idle|run|paused|waiting|blocked
// and ?others=N for extra jobs in the list.
(() => {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || 'idle';
  const others = Number(params.get('others') ?? 2);

  const now = Date.now();
  const currentTab = {
    id: 1,
    windowId: 1,
    active: true,
    url: state === 'blocked' ? 'chrome://settings/' : 'https://github.com/anthropics/claude-code/pulls',
    title: 'Pull requests · anthropics/claude-code',
    favIconUrl: '',
  };

  const jobs = {};
  if (state === 'run' || state === 'paused' || state === 'waiting') {
    jobs[1] = {
      tabId: 1, windowId: 1,
      url: currentTab.url, title: currentTab.title, favIconUrl: '',
      intervalSec: 300, variationSec: 15,
      onlyWhenInactive: state === 'waiting',
      remainingReloads: 18, reloadCount: 12,
      paused: state === 'paused',
      pausedRemainingMs: state === 'paused' ? 154000 : undefined,
      pendingReload: state === 'waiting',
      nextReloadAt: now + 154000,
    };
  }
  const sites = [
    ['https://dashboard.grafana.io/d/k8s', 92000],
    ['https://queue.dev/board/backend', 251000, 'paused'],
    ['https://news.ycombinator.com/newest', 17000],
    ['file:///home/sourav/report.html', 1830000],
  ];
  for (let i = 0; i < Math.min(others, sites.length); i++) {
    const [url, left, flag] = sites[i];
    jobs[10 + i] = {
      tabId: 10 + i, windowId: 1, url, title: url, favIconUrl: '',
      intervalSec: 300, variationSec: 0, onlyWhenInactive: false,
      remainingReloads: null, reloadCount: 3 + i,
      paused: flag === 'paused',
      pausedRemainingMs: flag === 'paused' ? left : undefined,
      pendingReload: false,
      nextReloadAt: now + left,
    };
  }

  window.chrome = {
    tabs: {
      query: async () => [currentTab],
      update: async () => {},
      get: async (id) => ({ id }),
    },
    windows: { update: async () => {} },
    storage: {
      local: { get: async () => ({ jobs }) },
      sync: { get: async () => ({ settings: { badge: true, defaultIntervalSec: 300 } }), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'start') {
          return {
            tabId: 1, windowId: 1, url: currentTab.url, title: currentTab.title, favIconUrl: '',
            ...msg.opts, reloadCount: 0, paused: false, pendingReload: false,
            remainingReloads: msg.opts.remainingReloads, nextReloadAt: Date.now() + msg.opts.intervalSec * 1000,
          };
        }
        return null;
      },
    },
  };
})();
