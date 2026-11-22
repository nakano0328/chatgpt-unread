// 未確認リストと実行中リストを管理し、ツールバーのバッジに件数を出す
//
// chrome.storage.local に保存する形:
//   unread:   { [key]: { key, sessionId, convId, title, url, preview, tabId, completedAt } }
//   running:  { [tabId]: { tabId, sessionId, convId, title, url, startedAt } }
//   mirrored: { [sessionId]: { state, title } }  CodeStatus に最後に送れた状態
// key は会話 ID があれば "c:<会話ID>"、一時チャットなど ID がなければ "tab:<タブID>"
// sessionId は質問 1 回ごとに作る。CodeStatus は一度終わったセッションを生き返らせないため

const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const NATIVE_HOST = 'dev.chatgpt_unread.codestatus';
// native-host/host.py が CodeStatus からのクリック用 URL に付ける印
const OPENED_FROM_CODESTATUS = '#codestatus';

function keyFor(convId, tabId) {
  return convId ? `c:${convId}` : `tab:${tabId}`;
}

// 読み込み→変更→保存が重ならないよう、更新は一列に並べて実行する
let queue = Promise.resolve();
function update(mutate) {
  queue = queue
    .then(async () => {
      const state = await chrome.storage.local.get({ unread: {}, running: {}, mirrored: {} });
      await mutate(state);
      await syncCodeStatus(state);
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

// CodeStatus に見せたいセッション: 生成中は busy、未確認は free、それ以外は出さない
function wantedSessions({ unread, running }) {
  const wanted = {};
  for (const entry of Object.values(running)) {
    if (entry.sessionId) wanted[entry.sessionId] = { state: 'busy', title: entry.title, url: entry.url };
  }
  for (const entry of Object.values(unread)) {
    if (entry.sessionId) wanted[entry.sessionId] = { state: 'free', title: entry.title, url: entry.url };
  }
  return wanted;
}

async function sendToCodeStatus(message) {
  try {
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, message);
    if (!reply?.ok) console.warn('[chatgpt-unread] CodeStatus に送れませんでした', reply);
    return reply?.ok === true;
  } catch (error) {
    // 中継プログラムが登録されていないとき。拡張だけでも使えるように黙って続ける
    console.warn('[chatgpt-unread] 中継プログラムを呼べませんでした', error.message);
    return false;
  }
}

// 前回 CodeStatus に送れた状態との差分だけ送る。1 件でも失敗したら残りは次の更新で送り直す
async function syncCodeStatus(state) {
  const wanted = wantedSessions(state);
  const { mirrored } = state;

  for (const sessionId of Object.keys(mirrored)) {
    if (wanted[sessionId]) continue;
    if (!(await sendToCodeStatus({ kind: 'SessionEnd', sessionId }))) return;
    delete mirrored[sessionId];
  }

  for (const [sessionId, want] of Object.entries(wanted)) {
    const have = mirrored[sessionId];
    if (have?.state === want.state && have.title === want.title) continue;
    const kind = want.state === 'busy' ? 'UserPromptSubmit' : 'Stop';
    if (!(await sendToCodeStatus({ kind, sessionId, title: want.title, url: want.url }))) return;
    mirrored[sessionId] = { state: want.state, title: want.title };
  }
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
          sessionId: `${key}-${Date.now()}`,
          convId: message.convId,
          title: message.title,
          url: message.url,
          startedAt: Date.now(),
        };
        break;
      case 'completed': {
        // 実行中の記録がない（生成中に拡張を読み込み直した）ときは、ここで新しく作る
        const sessionId = running[tabId]?.sessionId ?? `${key}-${Date.now()}`;
        delete running[tabId];
        if (!message.seen) {
          unread[key] = {
            key,
            sessionId,
            convId: message.convId,
            title: message.title,
            url: message.url,
            preview: message.preview,
            tabId,
            completedAt: Date.now(),
          };
        }
        break;
      }
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

// CodeStatus の一覧から開かれたタブは、同じ会話のタブがもうあればそちらを前面に出して閉じる
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url?.endsWith(OPENED_FROM_CODESTATUS)) return;
  const convId = url.match(/\/c\/([0-9a-zA-Z-]+)/)?.[1];
  if (!convId) return;
  const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
  const existing = tabs.find((tab) => tab.id !== tabId && tab.url?.includes(`/c/${convId}`));
  if (!existing) return;
  await chrome.tabs.update(existing.id, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
  await chrome.tabs.remove(tabId);
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
