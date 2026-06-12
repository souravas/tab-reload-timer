// In-memory chrome.* fake for unit-testing background.js under node --test.
// Implements only the surface background.js touches; storage clones values on
// both reads and writes, like the real (serializing) chrome.storage.

function fakeEvent() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    async fire(...args) {
      for (const fn of listeners) await fn(...args);
    },
  };
}

function storageArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
}

function makeChrome({ tabs = [], activeTab = null, focusedWindowId = null } = {}) {
  const alarms = new Map();
  const badges = [];
  const reloads = [];
  const notifications = [];
  const state = { tabs, activeTab, focusedWindowId };

  const chrome = {
    storage: {
      local: storageArea(),
      sync: storageArea(),
      onChanged: fakeEvent(),
    },
    alarms: {
      create: (name, info) => alarms.set(name, { name, ...info }),
      clear: async (name) => alarms.delete(name),
      getAll: async () => [...alarms.values()],
      onAlarm: fakeEvent(),
    },
    tabs: {
      query: async (q) => (q && q.active ? (state.activeTab ? [state.activeTab] : []) : [...state.tabs]),
      get: async (id) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`no tab ${id}`);
        return tab;
      },
      reload: async (id, opts) => {
        if (!state.tabs.some((t) => t.id === id)) throw new Error(`no tab ${id}`);
        reloads.push({ id, ...opts });
      },
      update: async () => {},
      onRemoved: fakeEvent(),
      onReplaced: fakeEvent(),
      onUpdated: fakeEvent(),
      onActivated: fakeEvent(),
    },
    windows: {
      get: async (id) => ({ id, focused: state.focusedWindowId === id }),
      onFocusChanged: fakeEvent(),
    },
    action: {
      setIcon: async () => {},
      setBadgeText: async (d) => badges.push(d),
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    contextMenus: {
      removeAll: (cb) => cb && cb(),
      create: () => {},
      update: (_id, _props, cb) => cb && cb(),
      onClicked: fakeEvent(),
    },
    commands: { onCommand: fakeEvent() },
    notifications: { create: (opts) => notifications.push(opts) },
    runtime: {
      onMessage: fakeEvent(),
      onInstalled: fakeEvent(),
      onStartup: fakeEvent(),
    },
  };

  return { chrome, alarms, badges, reloads, notifications, state };
}

module.exports = { makeChrome };
