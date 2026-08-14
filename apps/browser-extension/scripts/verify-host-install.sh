#!/usr/bin/env bash
# B-006: Verify WorkInsight native messaging host installation on macOS.
#
# Checks:
#   1. Native host manifest exists at correct Chrome location
#   2. Manifest JSON is valid and has required fields
#   3. Manifest "path" points to an existing, executable binary
#   4. "allowed_origins" contains a valid extension ID (not a placeholder)
#   5. IPC socket exists and has correct permissions (0600)
#   6. Bridge binary is actually executable
#
# Usage:
#   bash scripts/verify-host-install.sh [--extension-id <id>]
#
set -euo pipefail

HOST_NAME="com.workinsight.agent.bridge"
CHROME_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_MANIFEST="$CHROME_HOST_DIR/$HOST_NAME.json"
IPC_SOCKET_CANDIDATES=(
  "$HOME/Library/Application Support/com.workinsight.agent/agent-bridge.sock"
  "/tmp/com.workinsight.agent.bridge.sock"
)

EXPECTED_EXTENSION_ID=""
PASS=0
FAIL=0
SKIP=0

# ── Arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id) EXPECTED_EXTENSION_ID="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────
pass() {
  ((PASS++)) || true
  echo "  [PASS] $1"
}

fail() {
  ((FAIL++)) || true
  echo "  [FAIL] $1${2:+ — $2}"
}

skip() {
  ((SKIP++)) || true
  echo "  [SKIP] $1${2:+ — $2}"
}

check_json_field() {
  local file="$1"
  local field="$2"
  local label="$3"

  # Use python3 (available on all macOS) to parse JSON
  local value
  value=$(python3 -c "
import json, sys
try:
    with open('$file') as f:
        d = json.load(f)
    v = d.get('$field')
    if v is None:
        sys.exit(1)
    if isinstance(v, list):
        print(json.dumps(v))
    else:
        print(v)
except Exception:
    sys.exit(1)
" 2>/dev/null) || { fail "$label" "field '$field' missing or invalid"; return 1; }
  echo "$value"
}

# ── Banner ───────────────────────────────────────────────────────────────────
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  B-006: Verify Native Host Installation (macOS)      ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Check 1: Manifest exists ─────────────────────────────────────────────────
echo "── Check 1: Native host manifest ──"

if [[ -f "$HOST_MANIFEST" ]]; then
  pass "manifest exists at $HOST_MANIFEST"
else
  fail "manifest not found at $HOST_MANIFEST"
  echo ""
  echo "  Hint: Run scripts/install-host-macos.sh --extension-id <32-hex>"
  echo ""
  echo "══════════════════════ Summary ══════════════════════"
  echo "  $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
fi

# ── Check 2: Manifest is valid JSON ──────────────────────────────────────────
echo ""
echo "── Check 2: Manifest JSON validity ──"

if python3 -c "import json; json.load(open('$HOST_MANIFEST'))" 2>/dev/null; then
  pass "manifest is valid JSON"
else
  fail "manifest is not valid JSON"
fi

# ── Check 3: Required fields ─────────────────────────────────────────────────
echo ""
echo "── Check 3: Required manifest fields ──"

# name
manifest_name=$(check_json_field "$HOST_MANIFEST" "name" "manifest.name") || true
if [[ -n "$manifest_name" ]]; then
  if [[ "$manifest_name" == "$HOST_NAME" ]]; then
    pass "manifest.name = $HOST_NAME"
  else
    fail "manifest.name" "expected '$HOST_NAME', got '$manifest_name'"
  fi
fi

# type
manifest_type=$(check_json_field "$HOST_MANIFEST" "type" "manifest.type") || true
if [[ -n "$manifest_type" ]]; then
  if [[ "$manifest_type" == "stdio" ]]; then
    pass "manifest.type = stdio"
  else
    fail "manifest.type" "expected 'stdio', got '$manifest_type'"
  fi
fi

# path
manifest_path=$(check_json_field "$HOST_MANIFEST" "path" "manifest.path") || true
if [[ -n "$manifest_path" ]]; then
  pass "manifest.path = $manifest_path"
fi

# ── Check 4: Binary exists and is executable ─────────────────────────────────
echo ""
echo "── Check 4: Bridge binary ──"

if [[ -n "${manifest_path:-}" ]]; then
  if [[ -f "$manifest_path" ]]; then
    pass "binary exists at $manifest_path"

    if [[ -x "$manifest_path" ]]; then
      pass "binary is executable"
    else
      fail "binary is not executable" "run: chmod +x '$manifest_path'"
    fi

    # Check it's actually a Mach-O binary (not a script placeholder)
    file_type=$(file -b "$manifest_path" 2>/dev/null || echo "unknown")
    if echo "$file_type" | grep -qi "mach-o\|executable"; then
      pass "binary is a Mach-O executable"
    elif echo "$file_type" | grep -qi "script\|text"; then
      skip "binary appears to be a script (may be a dev placeholder)"
    else
      skip "binary type unknown: $file_type"
    fi
  else
    fail "binary not found at $manifest_path"
  fi
else
  skip "binary check" "manifest.path not available"
fi

# ── Check 5: allowed_origins ─────────────────────────────────────────────────
echo ""
echo "── Check 5: allowed_origins ──"

origins_json=$(check_json_field "$HOST_MANIFEST" "allowed_origins" "manifest.allowed_origins") || true
if [[ -n "$origins_json" ]]; then
  # Extract the extension ID from the first origin
  actual_id=$(python3 -c "
import json, sys, re
origins = json.loads('$origins_json')
if origins:
    m = re.match(r'chrome-extension://([a-p]{32})/', origins[0])
    if m:
        print(m.group(1))
    else:
        print('INVALID')
else:
    print('EMPTY')
" 2>/dev/null || echo "PARSE_ERROR")

  if [[ "$actual_id" == "INVALID" || "$actual_id" == "EMPTY" || "$actual_id" == "PARSE_ERROR" ]]; then
    fail "allowed_origins" "no valid extension ID found in $origins_json"
  else
    pass "extension ID = $actual_id"

    # Check for placeholder
    if echo "$actual_id" | grep -qi "REPLACE\|XXXX\|YOUR\|TODO"; then
      fail "allowed_origins" "contains placeholder text"
    else
      pass "no placeholder text in extension ID"
    fi

    # Verify against expected if provided
    if [[ -n "$EXPECTED_EXTENSION_ID" ]]; then
      if [[ "$actual_id" == "$EXPECTED_EXTENSION_ID" ]]; then
        pass "extension ID matches expected"
      else
        fail "extension ID mismatch" "expected $EXPECTED_EXTENSION_ID, got $actual_id"
      fi
    fi

    # Validate format: 32 lowercase hex chars [a-p]
    if [[ "$actual_id" =~ ^[a-p]{32}$ ]]; then
      pass "extension ID format valid (32 chars [a-p])"
    else
      fail "extension ID format" "expected 32 chars in [a-p], got '$actual_id'"
    fi
  fi
fi

# ── Check 6: IPC socket ─────────────────────────────────────────────────────
echo ""
echo "── Check 6: IPC socket ──"

socket_found=0
for sock in "${IPC_SOCKET_CANDIDATES[@]}"; do
  if [[ -S "$sock" ]]; then
    pass "IPC socket exists at $sock"
    socket_found=1

    # Check permissions
    perms=$(stat -f "%Lp" "$sock" 2>/dev/null || stat -c "%a" "$sock" 2>/dev/null || echo "unknown")
    if [[ "$perms" == "600" ]]; then
      pass "socket permissions = 0600 (correct)"
    elif [[ "$perms" == "unknown" ]]; then
      skip "socket permissions" "could not read permissions"
    else
      fail "socket permissions" "expected 0600, got $perms"
    fi

    # Check ownership
    owner=$(stat -f "%Su" "$sock" 2>/dev/null || stat -c "%U" "$sock" 2>/dev/null || echo "unknown")
    if [[ "$owner" == "$(whoami)" ]]; then
      pass "socket owned by current user ($owner)"
    elif [[ "$owner" == "unknown" ]]; then
      skip "socket ownership" "could not read owner"
    else
      fail "socket ownership" "expected $(whoami), got $owner"
    fi

    break
  fi
done

if [[ "$socket_found" -eq 0 ]]; then
  skip "IPC socket" "no socket found in candidates (agent may not be running)"
fi

# ── Check 7: Chrome NativeMessagingHosts directory permissions ───────────────
echo ""
echo "── Check 7: Chrome host directory ──"

if [[ -d "$CHROME_HOST_DIR" ]]; then
  dir_perms=$(stat -f "%Lp" "$CHROME_HOST_DIR" 2>/dev/null || echo "unknown")
  pass "Chrome NativeMessagingHosts directory exists"
  if [[ "$dir_perms" != "unknown" ]]; then
    pass "directory permissions = $dir_perms"
  fi
else
  fail "Chrome NativeMessagingHosts directory missing" "$CHROME_HOST_DIR"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════ Summary ══════════════════════"
echo "  $PASS passed, $FAIL failed, $SKIP skipped"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "  Fix the failed checks above before using the browser extension."
  echo "  Run: scripts/install-host-macos.sh --extension-id <your-extension-id>"
  exit 1
else
  echo ""
  echo "  All checks passed. Native host is correctly installed."
  exit 0
fi
