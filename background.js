// 未確認リストと実行中リストを管理し、ツールバーのバッジに件数を出す
//
// chrome.storage.local に保存する形:
//   unread:  { [key]: { key, convId, title, url, preview, tabId, completedAt } }
//   running: { [tabId]: { tabId, convId, title, url, startedAt } }
// key は会話 ID があれば "c:<会話ID>"、一時チャットなど ID がなければ "tab:<タブID>"

const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

function keyFor(convId, tabId) {
  return convId ? `c:${convId}` : `tab:${tabId}`;
}

// 読み込み→変更→保存が重ならないよう、更新は一列に並べて実行する
let queue = Promise.resolve();
function update(mutate) {
  queue = queue
    .then(async () => {
      const state = await chrome.storage.local.get({ unread: {}, running: {} });
      await mutate(state);
      await chrome.storage.local.set(state);
      await refreshBadge(state);
    })
    .catch((error) => console.error('[chatgpt-unread]', error));
  return queue;
}

async function refreshBadge({ unread, running }) {
  const unreadCount = Object.keys(unread).length;
  const runningCount = Object.keys(running).length;
  await chrome.action.setBadgeText({
    text: unreadCount ? String(unreadCount) : runningCount ? '…' : '',
  });
  await chrome.action.setBadgeBackgroundColor({ color: unreadCount ? '#d93025' : '#5f6368' });
}

async function findConversationTab(entry) {
  if (entry.tabId != null) {
    const tab = await chrome.tabs.get(entry.tabId).catch(() => null);
    if (tab && (!entry.convId || tab.url?.includes(`/c/${entry.convId}`))) return tab;
  }
  if (!entry.convId) return null;
  const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
  return tabs.find((tab) => tab.url?.includes(`/c/${entry.convId}`)) ?? null;
}

async function focusConversation(entry) {
  const tab = await findConversationTab(entry);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else if (entry.url) {
    await chrome.tabs.create({ url: entry.url });
  }
}

function handleFromPage(message, tabId) {
  const key = keyFor(message.convId, tabId);
  update(({ unread, running }) => {
    switch (message.type) {
      case 'hello':
        // ページを読み込み直したら、そのタブの実行中表示はいったん消す
        delete running[tabId];
        break;
      case 'started':
        // 同じ会話で次の質問を送った = 前の回答は見たので未確認から外す
        delete unread[key];
        running[tabId] = {
          tabId,
          convId: message.convId,
          title: message.title,
          url: message.url,
          startedAt: Date.now(),
        };
        break;
      case 'completed':
        delete running[tabId];
        if (!message.seen) {
          unread[key] = {
            key,
            convId: message.convId,
            title: message.title,
            url: message.url,
            preview: message.preview,
            tabId,
            completedAt: Date.now(),
          };
        }
        break;
      case 'cancelled':
        delete running[tabId];
        break;
      case 'title':
        if (unread[key]) unread[key].title = message.title;
        if (running[tabId]) running[tabId].title = message.title;
        break;
      case 'viewing':
        delete unread[key];
        break;
    }
  });
}

function handleFromPopup(message) {
  switch (message.type) {
    case 'open':
      update(async ({ unread }) => {
        const entry = unread[message.key];
        if (!entry) return;
        delete unread[message.key];
        await focusConversation(entry);
      });
      break;
    case 'focusRunning':
      update(async ({ running }) => {
        const entry = running[message.tabId];
        if (entry) await focusConversation(entry);
      });
      break;
    case 'markRead':
      update(({ unread }) => {
        delete unread[message.key];
      });
      break;
    case 'markAllRead':
      update((state) => {
        state.unread = {};
      });
      break;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab?.id != null) {
    handleFromPage(message, sender.tab.id);
  } else {
    handleFromPopup(message);
    sendResponse({ ok: true });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  update(({ unread, running }) => {
    delete running[tabId];
    // 一時チャットはタブを閉じると戻れないので、未確認からも外す
    delete unread[keyFor(null, tabId)];
  });
});

// ブラウザ再起動後はタブ ID が変わるので、実行中の記録は捨てる
chrome.runtime.onStartup.addListener(() => {
  update((state) => {
    state.running = {};
  });
});

chrome.runtime.onInstalled.addListener(() => {
  update(() => {});
});
