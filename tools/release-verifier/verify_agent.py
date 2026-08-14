#!/usr/bin/env python3
"""Release verifier: scans agent artifacts & dependency graph for forbidden
analysis/LLM components and tracks repo hygiene. Exit 0 = clean, 1 = violation."""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_CRATES = {
    "openai", "anthropic", "ollama", "llm", "vllm", "transformers",
    "tokenizers", "tch", "candle", "mistralrs", "smartcore", "linfa",
}

FORBIDDEN_PATH_PARTS = ["insight", "analytics", "llm", "prompt"]
ALLOWED_PACKAGE_PREFIXES = ("workinsight", "agent", "browser", "collector")

FORBIDDEN_BINARY_PATTERNS = [
    "api.openai.com", "api.anthropic.com", "api.deepseek.com", "ollama",
    "sk-", "prompt_template", "model_weights", "chat/completions",
]

TRACKED_GENERATED_PATTERNS = [
    r"(^|/)target/",
    r"(^|/)node_modules/",
    r"(^|/)\.next/",
    r"(^|/)\.DS_Store$",
]


def git_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True,
    )
    return Path(out.stdout.strip())


def scan_git_tracked_generated(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, cwd=root,
    )
    if out.returncode != 0:
        return ["git ls-files failed"]
    violations = []
    for line in out.stdout.splitlines():
        if any(re.search(p, line) for p in TRACKED_GENERATED_PATTERNS):
            violations.append(f"generated file tracked in git: {line}")
    return violations


def scan_cargo_deps(workdir: Path) -> list[str]:
    out = subprocess.run(
        ["cargo", "tree", "--workspace", "--edges", "normal"],
        capture_output=True, text=True, cwd=workdir,
    )
    if out.returncode != 0:
        return ["cargo tree failed: " + out.stderr[-300:]]
    violations = []
    for line in out.stdout.splitlines():
        m = re.match(r"(\S+) v", line.strip())
        if m and m.group(1).lower() in FORBIDDEN_CRATES:
            violations.append("forbidden crate in agent deps: " + line.strip())
    return violations


def scan_source_paths(workdir: Path) -> list[str]:
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1"],
        capture_output=True, text=True, cwd=workdir,
    )
    if out.returncode != 0:
        return ["cargo metadata failed"]
    violations = []
    meta = json.loads(out.stdout)
    for pkg in meta["packages"]:
        name = pkg["name"].lower()
        if any(part in name for part in FORBIDDEN_PATH_PARTS) and not name.startswith(ALLOWED_PACKAGE_PREFIXES):
            violations.append(f"suspicious package name in workspace: {pkg['name']}")
    return violations


def scan_binary_strings(binary: Path) -> list[str]:
    if not binary.is_file():
        return [f"artifact not found: {binary}"]
    try:
        out = subprocess.run(["strings", str(binary)], capture_output=True, text=True)
    except FileNotFoundError:
        return ["strings tool unavailable"]
    if out.returncode != 0:
        return ["strings scan failed: " + out.stderr[-300:]]
    violations = []
    for pat in FORBIDDEN_BINARY_PATTERNS:
        if pat in out.stdout:
            violations.append(f"forbidden string in binary: {pat}")
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, help="path to final agent binary")
    parser.add_argument(
        "--workspace-dir",
        default="apps/endpoint-agent/src-tauri",
        help="cargo workspace directory (default: agent workspace)",
    )
    args = parser.parse_args()

    root = git_root()
    ws = Path(args.workspace_dir)
    artifact = Path(args.artifact).expanduser()

    violations = []
    violations += scan_git_tracked_generated(root)
    violations += scan_cargo_deps(ws)
    violations += scan_source_paths(ws)
    violations += scan_binary_strings(artifact)

    if violations:
        print("VERIFY FAIL: agent artifacts or repo hygiene violations")
        for v in violations:
            print("  -", v)
        return 1

    print("VERIFY OK: no forbidden crates, packages, strings, or tracked generated files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
