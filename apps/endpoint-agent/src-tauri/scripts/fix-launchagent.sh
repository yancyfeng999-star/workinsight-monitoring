#!/usr/bin/env bash
# Post-bundle fix: Tauri places resources under Contents/Resources, but
# SMAppService.agent(plistName:) requires the LaunchAgent plist at
# Contents/Library/LaunchAgents/. Move it there (if present) and re-sign.
set -euo pipefail

APP="${1:?usage: fix-launchagent.sh /path/to/WorkInsight Agent.app}"
PLIST_SRC="$APP/Contents/Resources/Library/LaunchAgents/com.workinsight.agent.plist"
PLIST_DST_DIR="$APP/Contents/Library/LaunchAgents"
PLIST_DST="$PLIST_DST_DIR/com.workinsight.agent.plist"

if [[ -f "$PLIST_SRC" ]]; then
  mkdir -p "$PLIST_DST_DIR"
  cp "$PLIST_SRC" "$PLIST_DST"
  rm -rf "$APP/Contents/Resources/Library"
  echo "moved LaunchAgent plist to $PLIST_DST"
else
  echo "warning: plist not found at $PLIST_SRC (already fixed?)" >&2
fi

if [[ -x "$(command -v codesign)" ]]; then
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
fi
