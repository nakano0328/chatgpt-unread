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

## CodeStatus のメニューバーにも出す

ChatGPT 対応を足した [CodeStatus の Fork](https://github.com/nakano0328/codestatus/tree/chatgpt) を使うと、ChatGPT の生成中・未確認の会話を Claude Code / Codex と同じ一覧に出せます。

```bash
cd ~/asobi/codestatus && git switch chatgpt && scripts/install-local.sh
```

```bash
cd ~/asobi/chatgpt-unread && ./native-host/install.sh
```

その後、`chrome://extensions` で拡張を再読み込みします。

- 生成中は busy、未確認は free として、会話タイトルの名前で並ぶ（種類は「ChatGPT」、右端は「Chrome」）
- 一覧の行をクリックすると、その会話が Chrome で開く。同じ会話のタブがあればそちらに切り替わる
- 拡張側で確認済みになると、CodeStatus の一覧からも消える
- 見ていない間に完了すると、CodeStatus の通知が出る

登録を外すときは `./native-host/install.sh --uninstall` を実行します。

### 仕組みと制約

- 拡張 → Native Messaging → `native-host/host.py` → CodeStatus のソケット（`~/Library/Application Support/CodeStatus/run/`）
- host.py は CodeStatus の hook と同じ形式（1 行の JSON）で `UserPromptSubmit` / `Stop` / `SessionEnd` を送り、`provider: "chatgpt"`・`title`・`conversation_url` を付ける
- Fork 側では、ChatGPT の行はプロセスを持たないものとして扱い、スリープ復帰・CodeStatus の再起動でも消えたり「reconnecting」になったりしない
- 会話タイトルは CodeStatus のファイルには保存しない（本家の方針どおり）ので、CodeStatus を再起動した直後は、次の変化まで行の名前が「ChatGPT」になる
- CodeStatus が起動していないときに起きた変化は、次に拡張の状態が変わったときにまとめて送り直す
- Fork 版は簡易署名なので自動アップデートは動かない。本家の更新を取り込むときは、Fork に upstream をマージして `scripts/install-local.sh` を再実行する

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
- 中継プログラムは `/usr/bin/python3 test/test_host.py` で、偽の CodeStatus ソケットに向けて確かめる

## 検出できなくなったとき

ChatGPT の画面が変わると、生成中の判定がずれることがあります。

1. ChatGPT のタブで DevTools のコンソールを開き、次を実行してリロードする
   ```js
   localStorage.setItem('chatgpt-unread-debug', '1')
   ```
2. 質問を送って、`[chatgpt-unread] send {type: 'started'...}` と `completed` が出るか見る
3. 出なければ、生成中に表示される停止ボタンを要素の検証で調べ、`content.js` の `GENERATING_SELECTORS` に追加する

ログを止めるには `localStorage.removeItem('chatgpt-unread-debug')` を実行します。

