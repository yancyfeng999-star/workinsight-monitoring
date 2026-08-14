#!/usr/bin/env bash
# Install the WorkInsight native messaging host for macOS.
# Usage: install-host-macos.sh --extension-id <32-hex-chars> [--uninstall]
set -euo pipefail

EXTENSION_ID=""
UNINSTALL=0
HOST_NAME="com.workinsight.agent.bridge"
HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_JSON="$HOST_DIR/$HOST_NAME.json"
BRIDGE_BIN="/Applications/WorkInsight Agent.app/Contents/MacOS/workinsight-bridge"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id) EXTENSION_ID="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$UNINSTALL" == "1" ]]; then
  rm -f "$HOST_JSON"
  echo "removed $HOST_JSON"
  exit 0
fi

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "error: --extension-id must be a 32-char Chromium extension ID" >&2
  exit 2
fi
if [[ ! -x "$BRIDGE_BIN" ]]; then
  echo "error: bridge binary not found at $BRIDGE_BIN" >&2
  exit 2
fi

mkdir -p "$HOST_DIR"
cat > "$HOST_JSON" <<EOF
{
  "name": "$HOST_NAME",
  "description": "WorkInsight agent native messaging host",
  "path": "$BRIDGE_BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
echo "installed $HOST_JSON"
