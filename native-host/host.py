#!/usr/bin/python3
"""Chrome 拡張から受け取った ChatGPT の状態を CodeStatus のソケットへ流す中継プログラム。

Chrome の Native Messaging で 1 メッセージごとに起動され、1 つ処理して返事をして終わる。
macOS 標準の /usr/bin/python3 (3.9) で動くよう、標準ライブラリだけで書いている。

送り先は ChatGPT 対応を足した CodeStatus の Fork (nakano0328/codestatus の chatgpt ブランチ)。
provider "chatgpt" として送ると、一覧に会話タイトルで並び、クリックで conversation_url が
Chrome で開く。
"""

import json
import os
import shutil
import socket
import struct
import sys
import time

HOME = os.path.expanduser("~")
# テストでは環境変数で差し替える
DATA_DIR = os.environ.get(
    "CHATGPT_UNREAD_DATA", os.path.join(HOME, "Library/Application Support/chatgpt-unread")
)
CODESTATUS_RUN = os.environ.get(
    "CODESTATUS_RUN", os.path.join(HOME, "Library/Application Support/CodeStatus/run")
)

KINDS = {"UserPromptSubmit", "Stop", "SessionEnd"}
# 拡張側でこの印の付いたタブを見つけたら、同じ会話の既存タブへ切り替える
OPENED_FROM_CODESTATUS = "#codestatus"


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length))


def write_message(message):
    body = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(body)) + body)
    sys.stdout.buffer.flush()


def socket_path():
    # CodeStatus は置き場所を移すことがあるので、まずポインタファイルを読む
    try:
        with open(os.path.join(CODESTATUS_RUN, "socket-path"), encoding="utf-8") as f:
            pointed = f.read().strip()
            if pointed:
                return pointed
    except OSError:
        pass
    return os.path.join(CODESTATUS_RUN, "e.sock")


def remove_old_links():
    # Fork 版より前は、行の名前とクリック先のためにリンクを作っていた。もう使わないので片付ける
    links = os.path.join(DATA_DIR, "links")
    if os.path.isdir(links):
        shutil.rmtree(links, ignore_errors=True)


_counter = 0


def send_event(kind, session_id, title=None, url=None):
    global _counter
    _counter += 1
    line = {
        "v": 1,
        "id": "chatgpt-unread-%d-%d-%d" % (os.getpid(), time.time_ns(), _counter),
        "provider": "chatgpt",
        "hook_event_name": kind,
        "session_id": "chatgpt-" + session_id,
        "turn_id": "chatgpt-" + session_id,
        "ts": time.time(),
    }
    if title:
        line["title"] = title
    if url:
        line["conversation_url"] = url.split("#")[0] + OPENED_FROM_CODESTATUS
    payload = (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8")

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(2)
        sock.connect(socket_path())
        sock.sendall(payload)


def handle(message):
    kind = message.get("kind")
    session_id = message.get("sessionId")
    if kind not in KINDS or not session_id:
        return {"ok": False, "error": "bad message"}

    if kind == "SessionEnd":
        send_event(kind, session_id)
    else:
        send_event(kind, session_id, message.get("title"), message.get("url"))
    return {"ok": True}


def main():
    remove_old_links()
    message = read_message()
    if message is None:
        return
    try:
        write_message(handle(message))
    except Exception as error:  # CodeStatus が起動していないときなど。拡張側で再送する
        write_message({"ok": False, "error": "%s: %s" % (type(error).__name__, error)})


if __name__ == "__main__":
    main()
