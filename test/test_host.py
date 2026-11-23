"""native-host/host.py を偽の CodeStatus ソケットに向けて動かし、送る内容とリンクを確かめる。

使い方: /usr/bin/python3 test/test_host.py
"""

import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest

HOST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "native-host", "host.py")


class FakeCodeStatus:
    """CodeStatus と同じく、1 接続 1 行の NDJSON を受け取るだけのソケット。"""

    def __init__(self, run_dir):
        self.lines = []
        self.path = os.path.join(run_dir, "e.sock")
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.path)
        self.server.listen()
        self.server.settimeout(5)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            with client:
                data = b""
                while not data.endswith(b"\n"):
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                self.lines.append(json.loads(data))

    def close(self):
        self.server.close()


class HostTest(unittest.TestCase):
    def setUp(self):
        # macOS の Unix ソケットはパスが 104 バイトまでなので、短い一時フォルダを使う
        self.tmp = tempfile.mkdtemp(prefix="cu-")
        self.run_dir = os.path.join(self.tmp, "run")
        self.data_dir = os.path.join(self.tmp, "data")
        os.makedirs(self.run_dir)
        self.env = dict(os.environ, CODESTATUS_RUN=self.run_dir, CHATGPT_UNREAD_DATA=self.data_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def call(self, message):
        body = json.dumps(message).encode()
        out = subprocess.run(
            [sys.executable, HOST],
            input=struct.pack("<I", len(body)) + body,
            capture_output=True,
            env=self.env,
            timeout=10,
            check=True,
        ).stdout
        (length,) = struct.unpack("<I", out[:4])
        return json.loads(out[4 : 4 + length])

    def wait_lines(self, server, count):
        for _ in range(100):
            if len(server.lines) >= count:
                return server.lines
            threading.Event().wait(0.02)
        self.fail("CodeStatus に %d 行届かなかった (実際: %d)" % (count, len(server.lines)))

    def test_busy_then_free_then_end(self):
        server = FakeCodeStatus(self.run_dir)
        self.addCleanup(server.close)
        url = "https://chatgpt.com/c/abc"

        self.assertEqual(self.call({"kind": "UserPromptSubmit", "sessionId": "c:abc-1", "title": "新しいチャット", "url": url}), {"ok": True})
        self.assertEqual(self.call({"kind": "Stop", "sessionId": "c:abc-1", "title": "日本の歴史: 要約/まとめ", "url": url}), {"ok": True})
        lines = self.wait_lines(server, 2)

        busy, free = lines
        self.assertEqual(busy["v"], 1)
        self.assertEqual(busy["hook_event_name"], "UserPromptSubmit")
        self.assertEqual(busy["provider"], "chatgpt")
        self.assertEqual(busy["session_id"], "chatgpt-c:abc-1")
        self.assertNotEqual(busy["id"], free["id"])
        self.assertEqual(free["hook_event_name"], "Stop")

        # タイトルはそのまま送り、クリック用の URL には拡張が既存タブを探すための印を付ける
        self.assertEqual(busy["title"], "新しいチャット")
        self.assertEqual(free["title"], "日本の歴史: 要約/まとめ")
        self.assertEqual(free["conversation_url"], url + "#codestatus")
        self.assertNotIn("cwd", free)

        self.assertEqual(self.call({"kind": "SessionEnd", "sessionId": "c:abc-1"}), {"ok": True})
        end = self.wait_lines(server, 3)[2]
        self.assertEqual(end["hook_event_name"], "SessionEnd")
        self.assertNotIn("title", end)
        self.assertNotIn("conversation_url", end)

    def test_removes_links_from_older_version(self):
        links = os.path.join(self.data_dir, "links", "c:old-1")
        os.makedirs(links)
        self.call({"kind": "PreToolUse", "sessionId": "x"})
        self.assertFalse(os.path.exists(os.path.join(self.data_dir, "links")))

    def test_codestatus_not_running(self):
        reply = self.call({"kind": "Stop", "sessionId": "c:abc-1", "title": "t", "url": "https://chatgpt.com/c/abc"})
        self.assertFalse(reply["ok"])

    def test_rejects_unknown_kind(self):
        self.assertEqual(self.call({"kind": "PreToolUse", "sessionId": "x"}), {"ok": False, "error": "bad message"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
