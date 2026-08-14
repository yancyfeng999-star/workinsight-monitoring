import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VERIFY = REPO_ROOT / "tools/release-verifier/verify_agent.py"


def run_verify(*args, cwd=None, env_extra=None):
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(VERIFY), *args],
        capture_output=True, text=True, cwd=cwd or REPO_ROOT, env=env,
    )


class VerifyAgentTest(unittest.TestCase):

    def test_git_tracked_target_is_violation(self):
        tracked = subprocess.run(
            ["git", "ls-files", "apps/endpoint-agent/src-tauri/target"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        ).stdout.splitlines()
        self.assertFalse(
            tracked,
            "target/ must not be tracked in git; remove with git rm --cached",
        )

    def test_missing_artifact_returns_nonzero(self):
        r = run_verify("--artifact", "/nonexistent/does-not-exist.bin")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("artifact", (r.stdout + r.stderr).lower())

    def test_forbidden_crate_fails_with_fixture(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "fake-llm-provider"
            fake.mkdir()
            (fake / "Cargo.toml").write_text(
                "[package]\nname = 'fake-llm-provider'\nversion = '0.1.0'\nedition = '2021'\n"
            )
            (fake / "src").mkdir()
            (fake / "src/lib.rs").write_text("pub fn x() {}\n")
            env = {"RUSTC": sys.executable + " -c import sys; sys.exit(0)"}
            r = run_verify(
                "--workspace-dir", str(fake),
                "--artifact", str(fake / "nope"),
                env_extra=env,
            )
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("llm", (r.stdout + r.stderr).lower())

    def test_strings_failure_is_handled(self):
        if sys.platform.startswith("win"):
            self.skipTest("strings may not exist on Windows")
        r = run_verify("--artifact", "/etc/hosts")
        self.assertIn(r.returncode, (0, 1))

    def test_clean_workspace_with_real_artifact_passes(self):
        artifact = REPO_ROOT / "apps/endpoint-agent/src-tauri/target/debug/workinsight-agent"
        if not artifact.exists():
            self.skipTest("agent binary not built in this environment")
        r = run_verify("--artifact", str(artifact))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
