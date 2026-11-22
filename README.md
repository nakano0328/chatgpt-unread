# ChatGPT Unread

Web 版 ChatGPT の回答完了を「未確認」として残し、確認するまで一覧に表示する Chrome 拡張です。
Claude Code / Codex は CodeStatus で管理し、ChatGPT だけこの拡張で補います。

## できること

- 回答が完了した会話を未確認として記録し、ツールバーのアイコンに件数をバッジで表示
- 生成中の会話も一覧に表示（未確認がないときはバッジが `…`）
- 一覧の会話をクリックすると、そのタブへ移動して確認済みにする（タブがなければ新しく開く）
- 次のときは自動で確認済みになる
  - その会話のタブを開いて見たとき
  - 完了した瞬間にその画面を見ていたとき
  - 同じ会話で次の質問を送ったとき

## インストール

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
4. ツールバーのパズルアイコンから「ChatGPT Unread」をピン留めする
5. すでに開いている ChatGPT のタブは再読み込みする

コードを変更したら、`chrome://extensions` でこの拡張の再読み込みボタンを押し、ChatGPT のタブも再読み込みしてください。

## 仕組み

| ファイル | 役割 |
| --- | --- |
| `content.js` | ChatGPT のページで停止ボタンの表示・非表示を監視し、生成の開始・完了・閲覧を background に送る |
| `background.js` | 未確認リストと実行中リストを `chrome.storage.local` に保存し、バッジを更新する |
| `popup.html` / `popup.js` / `popup.css` | アイコンをクリックしたときの一覧 |

停止ボタンが 1.5 秒消えたままになったら完了とみなします（検索や思考の切り替わりで一瞬消えるため）。

## テスト

偽の chrome API の上で `background.js` と `content.js` を動かし、停止ボタンの表示・非表示などを再現して確かめます。

```bash
python3 -m http.server 8765
```

- http://localhost:8765/test/harness.html を開くと、全テストの結果が表示される
- http://localhost:8765/test/popup-preview.html でサンプルデータ入りのポップアップの見た目を確認できる

## 検出できなくなったとき

ChatGPT の画面が変わると、生成中の判定がずれることがあります。

1. ChatGPT のタブで DevTools のコンソールを開き、次を実行してリロードする
   ```js
   localStorage.setItem('chatgpt-unread-debug', '1')
   ```
2. 質問を送って、`[chatgpt-unread] send {type: 'started'...}` と `completed` が出るか見る
3. 出なければ、生成中に表示される停止ボタンを要素の検証で調べ、`content.js` の `GENERATING_SELECTORS` に追加する

ログを止めるには `localStorage.removeItem('chatgpt-unread-debug')` を実行します。

## 今後の候補

- CodeStatus と統合して、メニューバーの一か所で見られるようにする（Native Messaging 経由）
