#!/bin/bash
# 中継プログラム (host.py) を Chrome の Native Messaging に登録する
#   ./native-host/install.sh              登録する
#   ./native-host/install.sh --uninstall  登録を外す
set -euo pipefail

NAME="dev.chatgpt_unread.codestatus"
HOSTS_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST="$HOSTS_DIR/$NAME.json"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$MANIFEST"
  echo "登録を外しました: $MANIFEST"
  exit 0
fi

HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(dirname "$HOST_DIR")"

# パッケージ化されていない拡張の ID は、読み込んだフォルダの絶対パスの SHA-256 から決まる
EXTENSION_ID="$(/usr/bin/python3 -c '
import hashlib, sys
digest = hashlib.sha256(sys.argv[1].encode()).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
' "$EXTENSION_DIR")"

chmod +x "$HOST_DIR/host.py"
mkdir -p "$HOSTS_DIR"
cat > "$MANIFEST" <<EOF
{
  "name": "$NAME",
  "description": "ChatGPT Unread から CodeStatus へ状態を送る中継プログラム",
  "path": "$HOST_DIR/host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo "登録しました: $MANIFEST"
echo "拡張 ID: $EXTENSION_ID (chrome://extensions の ID と同じか確認してください)"
