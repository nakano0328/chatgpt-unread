// テスト用に、background.js と content.js が使う chrome.* の部分だけを真似る
(() => {
  const data = {};
  const listeners = { changed: [], message: [], startup: [], installed: [], removed: [], updated: [] };
  const clone = (value) => structuredClone(value);

  const fake = {
    tabId: 7,
    looking: false,
    badge: { text: '', color: '' },
    tabs: [],
    focused: [],
    created: [],
    closed: [],
    // 中継プログラムに送ったメッセージ。nativeFails を true にすると未登録のように失敗する
    native: [],
    nativeFails: false,
    // ポップアップからの送信として扱う（sender.tab がない）
    async popupSend(message) {
      listeners.message.forEach((listener) => listener(message, {}, () => {}));
    },
    fireTabRemoved(tabId) {
      listeners.removed.forEach((listener) => listener(tabId));
    },
    fireTabUpdated(tabId, changeInfo) {
      return Promise.all(listeners.updated.map((listener) => listener(tabId, changeInfo)));
    },
  };
  window.__fake = fake;

  // content.js が「ユーザーが見ているか」を判定する部分をテストから切り替えられるようにする
  Object.defineProperty(document, 'visibilityState', {
    get: () => (fake.looking ? 'visible' : 'hidden'),
  });
  document.hasFocus = () => fake.looking;

  window.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const key in defaults) out[key] = clone(key in data ? data[key] : defaults[key]);
          return out;
        },
        async set(items) {
          const changes = {};
          for (const key in items) {
            changes[key] = { oldValue: data[key], newValue: clone(items[key]) };
            data[key] = clone(items[key]);
          }
          listeners.changed.forEach((listener) => listener(changes, 'local'));
        },
      },
      onChanged: { addListener: (listener) => listeners.changed.push(listener) },
    },
    runtime: {
      onMessage: { addListener: (listener) => listeners.message.push(listener) },
      onStartup: { addListener: (listener) => listeners.startup.push(listener) },
      onInstalled: { addListener: (listener) => listeners.installed.push(listener) },
      getManifest: () => ({ version: 'test' }),
      // content script からの送信として扱う
      async sendMessage(message) {
        listeners.message.forEach((listener) => listener(message, { tab: { id: fake.tabId } }, () => {}));
      },
      async sendNativeMessage(host, message) {
        if (fake.nativeFails) throw new Error('Specified native messaging host not found.');
        fake.native.push(message);
        return { ok: true };
      },
    },
    action: {
      async setBadgeText({ text }) {
        fake.badge.text = text;
      },
      async setBadgeBackgroundColor({ color }) {
        fake.badge.color = color;
      },
    },
    tabs: {
      async get(tabId) {
        const tab = fake.tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      async query() {
        return fake.tabs;
      },
      async update(tabId) {
        fake.focused.push(tabId);
      },
      async create({ url }) {
        fake.created.push(url);
      },
      async remove(tabId) {
        fake.closed.push(tabId);
      },
      onRemoved: { addListener: (listener) => listeners.removed.push(listener) },
      onUpdated: { addListener: (listener) => listeners.updated.push(listener) },
    },
    windows: {
      async update() {},
    },
  };
})();
