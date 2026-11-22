// 未確認・実行中の一覧を表示する。変更は background に頼み、表示は storage の変化に追従する

const $ = (id) => document.getElementById(id);

function ago(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'たった今';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

async function request(message, closeAfter = false) {
  await chrome.runtime.sendMessage(message);
  if (closeAfter) window.close();
}

// タイトルや本文はページ由来なので、必ず textContent で入れる
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function unreadItem(entry) {
  const li = element('li', 'item');

  const open = element('button', 'open');
  open.type = 'button';
  open.title = 'この会話を開く';
  open.append(element('span', 'title', entry.title));
  if (entry.preview) open.append(element('span', 'preview', entry.preview));
  open.append(element('span', 'meta', `${ago(entry.completedAt)}に完了`));
  open.addEventListener('click', () => request({ type: 'open', key: entry.key }, true));

  const check = element('button', 'check', '✓');
  check.type = 'button';
  check.title = '確認済みにする';
  check.addEventListener('click', () => request({ type: 'markRead', key: entry.key }));

  li.append(open, check);
  return li;
}

function runningItem(entry) {
  const li = element('li', 'item');
  const open = element('button', 'open');
  open.type = 'button';
  open.title = 'このタブに移動';
  open.append(element('span', 'title', entry.title));
  open.append(element('span', 'meta running', `生成中 · ${ago(entry.startedAt)}から`));
  open.addEventListener('click', () => request({ type: 'focusRunning', tabId: entry.tabId }, true));
  li.append(open);
  return li;
}

async function render() {
  const { unread, running } = await chrome.storage.local.get({ unread: {}, running: {} });

  const unreadEntries = Object.values(unread).sort((a, b) => b.completedAt - a.completedAt);
  $('unread').replaceChildren(...unreadEntries.map(unreadItem));
  $('unread-count').textContent = unreadEntries.length ? String(unreadEntries.length) : '';
  $('unread-empty').hidden = unreadEntries.length > 0;
  $('mark-all').hidden = unreadEntries.length === 0;

  const runningEntries = Object.values(running).sort((a, b) => b.startedAt - a.startedAt);
  $('running').replaceChildren(...runningEntries.map(runningItem));
  $('running-section').hidden = runningEntries.length === 0;
}

$('mark-all').addEventListener('click', () => request({ type: 'markAllRead' }));
chrome.storage.onChanged.addListener(render);
render();
