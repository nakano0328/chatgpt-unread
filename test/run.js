// 停止ボタンの表示・非表示などを再現し、未確認リストとバッジが期待通りに変わるか確かめる
// 使い方: プロジェクト直下で `python3 -m http.server 8765` を実行し、
//        http://localhost:8765/test/harness.html を開く

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(150);
const DONE_WAIT = DONE_STABLE_MS + 700;
const chat = document.getElementById('chat');
const state = () => chrome.storage.local.get({ unread: {}, running: {} });

// 2026-11 時点の本物の ChatGPT と同じく、送信ボタンの位置に aria-label="停止" のボタンが出る
function startGenerating() {
  if (document.getElementById('stop')) return;
  const button = document.createElement('button');
  button.id = 'stop';
  button.setAttribute('aria-label', '停止');
  chat.append(button);
}

function stopGenerating() {
  document.getElementById('stop')?.remove();
}

function addAnswer(text) {
  const answer = document.createElement('div');
  answer.dataset.markdownTextStyle = 'assistant-message';
  answer.textContent = text;
  chat.append(answer);
}

function goTo(path) {
  history.pushState(null, '', path);
  check();
}

async function complete() {
  startGenerating();
  await settle();
  stopGenerating();
  await sleep(DONE_WAIT);
}

async function reset() {
  stopGenerating();
  if (generating) await sleep(DONE_WAIT);
  __fake.looking = false;
  __fake.tabs = [];
  __fake.focused = [];
  __fake.created = [];
  chat.replaceChildren();
  goTo('/c/abc');
  document.title = 'ChatGPT';
  check();
  await settle();
  __fake.nativeFails = false;
  await update((s) => {
    s.unread = {};
    s.running = {};
  });
  __fake.native = [];
  __fake.closed = [];
}

// CodeStatus に送った種類の列。例: ['UserPromptSubmit', 'Stop']
const sentKinds = () => __fake.native.map((m) => m.kind);

const results = [];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

test('生成が始まると実行中になる', async () => {
  startGenerating();
  await settle();
  const { running } = await state();
  assert(running[7]?.convId === 'abc', 'running[7] が会話 abc');
  assert(__fake.badge.text === '…', `バッジが … (実際: "${__fake.badge.text}")`);
});

test('見ていない間に完了すると未確認に残る', async () => {
  addAnswer('これは   回答です');
  await complete();
  const { unread, running } = await state();
  assert(!running[7], 'running から消える');
  assert(unread['c:abc'], 'unread に c:abc がある');
  assert(unread['c:abc'].preview === 'これは 回答です', `preview (実際: "${unread['c:abc'].preview}")`);
  assert(__fake.badge.text === '1', `バッジが 1 (実際: "${__fake.badge.text}")`);
});

test('停止ボタンが一瞬消えただけでは完了にしない', async () => {
  startGenerating();
  await settle();
  stopGenerating();
  await sleep(500);
  startGenerating();
  await sleep(DONE_WAIT);
  let { unread, running } = await state();
  assert(!unread['c:abc'], 'まだ未確認にならない');
  assert(running[7], 'まだ実行中');
  stopGenerating();
  await sleep(DONE_WAIT);
  ({ unread } = await state());
  assert(unread['c:abc'], '本当に消えたら未確認になる');
});

test('非表示の入力欄に残った「停止」は生成中とみなさない', async () => {
  // 本物の ChatGPT では、前の画面の入力欄が display:none のまま「停止」を持ち続ける
  const stale = document.createElement('div');
  stale.style.display = 'none';
  const button = document.createElement('button');
  button.setAttribute('aria-label', '停止');
  stale.append(button);
  chat.append(stale);
  check();
  await settle();
  const { running } = await state();
  assert(!generating, '生成中にならない');
  assert(!running[7], '実行中に出ない');
});

test('新しいチャットの仮 ID (local-...) から本当の ID に変わっても記録する', async () => {
  goTo('/c/local-chatgpt');
  startGenerating();
  await settle();
  goTo('/c/real1');
  stopGenerating();
  await sleep(DONE_WAIT);
  const { unread } = await state();
  assert(unread['c:real1'], `c:real1 で未確認になる (実際: ${Object.keys(unread)})`);
  assert(!unread['c:local-chatgpt'], '仮 ID では記録しない');
});

test('その会話を見ると確認済みになる', async () => {
  await complete();
  __fake.looking = true;
  window.dispatchEvent(new Event('focus'));
  await settle();
  const { unread } = await state();
  assert(!unread['c:abc'], '未確認から消える');
  assert(__fake.badge.text === '', `バッジが空 (実際: "${__fake.badge.text}")`);
});

test('見ている間に完了したら未確認にしない', async () => {
  __fake.looking = true;
  await complete();
  const { unread } = await state();
  assert(Object.keys(unread).length === 0, '未確認が 0 件');
});

test('同じ会話で次の質問を送ると未確認から外れる', async () => {
  await complete();
  startGenerating();
  await settle();
  const { unread, running } = await state();
  assert(!unread['c:abc'], '未確認から消える');
  assert(running[7], '実行中になる');
});

test('生成中に別の会話へ移動したら記録しない', async () => {
  startGenerating();
  await settle();
  goTo('/c/other');
  stopGenerating();
  await sleep(DONE_WAIT);
  const { unread, running } = await state();
  assert(Object.keys(unread).length === 0, `未確認が 0 件 (実際: ${Object.keys(unread)})`);
  assert(!running[7], '実行中から消える');
});

test('新しいチャットは後から付いたタイトルに更新される', async () => {
  goTo('/');
  startGenerating();
  await settle();
  goTo('/c/new1');
  stopGenerating();
  await sleep(DONE_WAIT);
  let { unread } = await state();
  assert(unread['c:new1']?.title === '新しいチャット', `仮タイトル (実際: "${unread['c:new1']?.title}")`);
  document.title = '料理の相談';
  check();
  await settle();
  ({ unread } = await state());
  assert(unread['c:new1'].title === '料理の相談', `タイトル更新 (実際: "${unread['c:new1'].title}")`);
});

test('一覧から開くとそのタブへ移動して確認済みになる', async () => {
  await complete();
  __fake.tabs = [{ id: 7, windowId: 1, url: location.href }];
  await __fake.popupSend({ type: 'open', key: 'c:abc' });
  await settle();
  const { unread } = await state();
  assert(__fake.focused.includes(7), 'タブ 7 に移動');
  assert(__fake.created.length === 0, '新しいタブは開かない');
  assert(!unread['c:abc'], '未確認から消える');
});

test('タブが閉じられていたら新しく開く', async () => {
  await complete();
  __fake.tabs = [];
  await __fake.popupSend({ type: 'open', key: 'c:abc' });
  await settle();
  assert(__fake.created[0]?.endsWith('/c/abc'), `会話の URL を開く (実際: ${__fake.created})`);
});

test('すべて確認済みで全件消える', async () => {
  await complete();
  goTo('/c/xyz');
  await complete();
  let { unread } = await state();
  assert(Object.keys(unread).length === 2, `2 件たまる (実際: ${Object.keys(unread).length})`);
  await __fake.popupSend({ type: 'markAllRead' });
  await settle();
  ({ unread } = await state());
  assert(Object.keys(unread).length === 0, '0 件になる');
});

test('一時チャットはタブを閉じると未確認から消える', async () => {
  goTo('/?temporary-chat=true');
  await complete();
  let { unread } = await state();
  assert(unread['tab:7'], 'tab:7 で未確認になる');
  __fake.fireTabRemoved(7);
  await settle();
  ({ unread } = await state());
  assert(!unread['tab:7'], '閉じたら消える');
});

test('生成中のタブを閉じると実行中から消える', async () => {
  startGenerating();
  await settle();
  __fake.fireTabRemoved(7);
  await settle();
  const { running } = await state();
  assert(!running[7], '実行中から消える');
});

test('CodeStatus: 生成中は busy、完了で free、見たら終了を送る', async () => {
  startGenerating();
  await settle();
  assert(sentKinds().join() === 'UserPromptSubmit', `開始 (実際: ${sentKinds()})`);
  stopGenerating();
  await sleep(DONE_WAIT);
  assert(sentKinds().join() === 'UserPromptSubmit,Stop', `完了 (実際: ${sentKinds()})`);
  __fake.looking = true;
  window.dispatchEvent(new Event('focus'));
  await settle();
  assert(sentKinds().join() === 'UserPromptSubmit,Stop,SessionEnd', `確認 (実際: ${sentKinds()})`);
  const ids = new Set(__fake.native.map((m) => m.sessionId));
  assert(ids.size === 1, `同じセッション ID で送る (実際: ${[...ids]})`);
});

test('CodeStatus: 見ている間に完了したら一覧から消す', async () => {
  __fake.looking = true;
  await complete();
  assert(sentKinds().join() === 'UserPromptSubmit,SessionEnd', `実際: ${sentKinds()}`);
});

test('CodeStatus: 次の質問は別のセッションとして送る', async () => {
  await complete();
  startGenerating();
  await settle();
  assert(sentKinds().join() === 'UserPromptSubmit,Stop,SessionEnd,UserPromptSubmit', `実際: ${sentKinds()}`);
  const [first, , end, next] = __fake.native;
  assert(end.sessionId === first.sessionId, '前のセッションを終える');
  assert(next.sessionId !== first.sessionId, '新しいセッション ID');
});

test('CodeStatus: 後から付いたタイトルを送り直す', async () => {
  goTo('/');
  startGenerating();
  await settle();
  goTo('/c/new2');
  stopGenerating();
  await sleep(DONE_WAIT);
  document.title = '料理の相談';
  check();
  await settle();
  const last = __fake.native.at(-1);
  assert(last.kind === 'Stop' && last.title === '料理の相談', `実際: ${JSON.stringify(last)}`);
});

test('CodeStatus: 送れなくても未確認は残り、次の更新で送り直す', async () => {
  __fake.nativeFails = true;
  await complete();
  let { unread, mirrored } = await chrome.storage.local.get({ unread: {}, mirrored: {} });
  assert(unread['c:abc'], '未確認は残る');
  assert(Object.keys(mirrored).length === 0, '送れた記録はない');
  __fake.nativeFails = false;
  document.title = '再送のきっかけ';
  check();
  await settle();
  ({ mirrored } = await chrome.storage.local.get({ mirrored: {} }));
  assert(sentKinds().includes('Stop'), `Stop を送り直す (実際: ${sentKinds()})`);
  assert(Object.values(mirrored)[0]?.state === 'free', 'free として記録');
});

test('CodeStatus から開いたタブは、既存の会話タブに切り替えて閉じる', async () => {
  __fake.tabs = [
    { id: 7, windowId: 1, url: 'https://chatgpt.com/c/abc' },
    { id: 9, windowId: 1, url: 'https://chatgpt.com/c/abc#codestatus' },
  ];
  await __fake.fireTabUpdated(9, { url: 'https://chatgpt.com/c/abc#codestatus' });
  assert(__fake.focused.includes(7), '既存タブ 7 に移動');
  assert(__fake.closed.includes(9), '開いたタブ 9 は閉じる');
});

test('CodeStatus から開いた会話のタブがなければ、そのまま残す', async () => {
  __fake.tabs = [{ id: 9, windowId: 1, url: 'https://chatgpt.com/c/abc#codestatus' }];
  await __fake.fireTabUpdated(9, { url: 'https://chatgpt.com/c/abc#codestatus' });
  assert(__fake.closed.length === 0, '閉じない');
});

(async () => {
  for (const { name, fn } of tests) {
    await reset();
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  }
  const out = document.getElementById('out');
  out.replaceChildren(
    ...results.map(({ name, ok, error }) => {
      const line = document.createElement('div');
      line.className = ok ? 'pass' : 'fail';
      line.textContent = ok ? `PASS ${name}` : `FAIL ${name}: ${error}`;
      return line;
    }),
  );
  const failed = results.filter((r) => !r.ok).length;
  out.append(`\n${results.length - failed}/${results.length} passed`);
  window.__results = results;
})();
