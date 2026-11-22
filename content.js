// ChatGPT の画面を監視し、生成の開始・完了・会話の閲覧を background に伝える

// コンソールで localStorage.setItem('chatgpt-unread-debug', '1') してリロードするとログが出る
const DEBUG = localStorage.getItem('chatgpt-unread-debug') === '1';
const log = (...args) => DEBUG && console.log('[chatgpt-unread]', ...args);

// 生成中だけ表示される要素。ChatGPT の UI が変わって検出できなくなったらここを直す
// 2026-11 時点の日本語 UI では、送信ボタンが aria-label="停止" のボタンに入れ替わる
const GENERATING_SELECTORS = [
  'button[aria-label="停止"]',
  'button[aria-label="Stop"]',
  'button[aria-label="Stop streaming"]',
  'button[data-testid="stop-button"]',
];

// 回答本文。最初の候補が見つからなければ次を試す
const ANSWER_SELECTORS = [
  '[data-markdown-text-style="assistant-message"]',
  '[data-message-author-role="assistant"]',
];

// ChatGPT は前の画面の入力欄を非表示のまま残すことがあり、そこに「停止」が残り続けるので、見えているものだけ数える
function findVisible(selector) {
  return [...document.querySelectorAll(selector)].filter((el) => el.checkVisibility());
}

// 停止ボタンは検索・思考の切り替わりで一瞬消えることがあるので、この時間消えたままなら完了とみなす
const DONE_STABLE_MS = 1500;

function isGenerating() {
  return GENERATING_SELECTORS.some((selector) => findVisible(selector).length > 0);
}

function conversationId() {
  const match = location.pathname.match(/\/c\/([0-9a-zA-Z-]+)/);
  // 新しいチャットは本当の ID が決まるまで /c/local-... になるので、ID なしとして扱う
  if (!match || match[1].startsWith('local-')) return null;
  return match[1];
}

function conversationTitle() {
  const title = document.title.trim();
  return title && title !== 'ChatGPT' ? title : '新しいチャット';
}

function lastAnswerPreview() {
  for (const selector of ANSWER_SELECTORS) {
    const last = findVisible(selector).at(-1);
    if (last) return last.innerText.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return '';
}

function isUserLooking() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function send(message) {
  log('send', message);
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // 拡張を再読み込みした直後は古い content script の接続が切れているので無視する
  }
}

let generating = false;
let startConvId = null;
let doneTimer = null;
let lastHref = location.href;
let lastTitle = document.title;

function check() {
  if (isGenerating()) {
    clearTimeout(doneTimer);
    doneTimer = null;
    if (!generating) {
      generating = true;
      startConvId = conversationId();
      send({ type: 'started', convId: startConvId, title: conversationTitle(), url: location.href });
    }
  } else if (generating && !doneTimer) {
    doneTimer = setTimeout(finish, DONE_STABLE_MS);
  }

  if (location.href !== lastHref) {
    lastHref = location.href;
    reportViewing();
  }

  // 新しいチャットのタイトルは回答の後に付くので、変わったら知らせる
  if (document.title !== lastTitle) {
    lastTitle = document.title;
    send({ type: 'title', convId: conversationId(), title: conversationTitle() });
  }
}

function finish() {
  doneTimer = null;
  if (isGenerating()) return;
  generating = false;

  const convId = conversationId();
  // 生成中に別の会話へ移動した場合は、どの会話が終わったか分からないので記録しない
  if (startConvId && convId !== startConvId) {
    send({ type: 'cancelled' });
    return;
  }
  send({
    type: 'completed',
    convId,
    title: conversationTitle(),
    url: location.href,
    preview: lastAnswerPreview(),
    seen: isUserLooking(),
  });
}

function reportViewing() {
  if (isUserLooking()) send({ type: 'viewing', convId: conversationId() });
}

// version はログで「新しいコードが読み込まれたか」を確かめるため
send({ type: 'hello', version: chrome.runtime.getManifest().version });
window.addEventListener('focus', reportViewing);
document.addEventListener('visibilitychange', reportViewing);
new MutationObserver(check).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['data-testid', 'aria-label', 'class'],
});
// 監視の取りこぼし対策
setInterval(check, 2000);
check();
