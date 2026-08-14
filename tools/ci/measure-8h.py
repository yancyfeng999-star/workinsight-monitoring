#!/usr/bin/env python3
"""8-hour gate sampler: records agent RSS/CPU/queue/network every 5 minutes."""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

AGENT = sys.argv[1] if len(sys.argv) > 1 else "workinsight-agent"
DURATION_H = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
OUT = sys.argv[3] if len(sys.argv) > 3 else "/tmp/aw-8h-samples.jsonl"
QUEUE_DB = os.path.expanduser("~/Library/Application Support/com.workinsight.agent/queue.db")

def rss_mb(pid):
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    try:
        return int(out.stdout.strip()) / 1024.0
    except ValueError:
        return None

def cpu_pct(pid):
    out = subprocess.run(["ps", "-o", "%cpu=", "-p", str(pid)], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None

def queue_depth():
    out = subprocess.run(["sqlite3", QUEUE_DB, "SELECT COUNT(*) FROM events"], capture_output=True, text=True)
    try:
        return int(out.stdout.strip())
    except Exception:
        return None

def find_pid():
    out = subprocess.run(["pgrep", "-f", AGENT], capture_output=True, text=True)
    pids = out.stdout.strip().splitlines()
    return int(pids[0]) if pids else None

def main():
    start = time.time()
    with open(OUT, "w") as f:
        while time.time() - start < DURATION_H * 3600:
            pid = find_pid()
            sample = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "pid": pid,
                "rss_mb": rss_mb(pid) if pid else None,
                "cpu_pct": cpu_pct(pid) if pid else None,
                "queue_depth": queue_depth(),
            }
            f.write(json.dumps(sample) + "\n")
            f.flush()
            time.sleep(300)
    print(f"samples written to {OUT}")

if __name__ == "__main__":
    main()
