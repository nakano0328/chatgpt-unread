#!/usr/bin/python3
"""Chrome 拡張から受け取った ChatGPT の状態を CodeStatus のソケットへ流す中継プログラム。

Chrome の Native Messaging で 1 メッセージごとに起動され、1 つ処理して返事をして終わる。
macOS 標準の /usr/bin/python3 (3.9) で動くよう、標準ライブラリだけで書いている。

CodeStatus 側から見ると provider が未知の「Agent」セッションに見える。一覧の行の名前は
cwd の最後の要素になり、クリックすると cwd が開かれるので、cwd には
「ChatGPT · 会話タイトル」という名前で会話 URL の .webloc を指すシンボリックリンクを渡す。
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
TITLE_MAX = 60


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


def safe_name(text):
    # ファイル名に使えない / と、Finder で / に化ける : を置き換える
    cleaned = " ".join(text.replace("/", "／").replace(":", "：").split())
    return cleaned[:TITLE_MAX] or "新しいチャット"


def link_dir(session_id):
    return os.path.join(DATA_DIR, "links", safe_name(session_id))


def write_link(session_id, title, url):
    """会話 URL を開く .webloc と、それを指す「ChatGPT · タイトル」のリンクを作り、リンクのパスを返す。"""
    directory = link_dir(session_id)
    os.makedirs(directory, exist_ok=True)

    target = os.path.join(directory, "open.webloc")
    url = (url or "https://chatgpt.com/").split("#")[0] + OPENED_FROM_CODESTATUS
    with open(target, "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0"><dict><key>URL</key><string>'
            + url.replace("&", "&amp;").replace("<", "&lt;")
            + "</string></dict></plist>\n"
        )

    # タイトルが変わったときに古いリンクが残らないよう、作り直す
    for name in os.listdir(directory):
        if name != "open.webloc":
            os.remove(os.path.join(directory, name))
    link = os.path.join(directory, "ChatGPT · " + safe_name(title))
    os.symlink(target, link)
    return link


_counter = 0


def send_event(kind, session_id, cwd):
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
    if cwd:
        line["cwd"] = cwd
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
        send_event(kind, session_id, None)
        shutil.rmtree(link_dir(session_id), ignore_errors=True)
    else:
        cwd = write_link(session_id, message.get("title") or "", message.get("url"))
        send_event(kind, session_id, cwd)
    return {"ok": True}


def main():
    message = read_message()
    if message is None:
        return
    try:
        write_message(handle(message))
    except Exception as error:  # CodeStatus が起動していないときなど。拡張側で再送する
        write_message({"ok": False, "error": "%s: %s" % (type(error).__name__, error)})


if __name__ == "__main__":
    main()
