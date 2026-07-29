"""Tests for scripts/session-pointers.py.

Run: python3 -m pytest scripts/tests -q
"""

import importlib.util
import json
import os
import sys

import pytest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "session-pointers.py")


@pytest.fixture
def sp(tmp_path, monkeypatch):
    """Load the script with the vault pointed at a temp dir."""
    monkeypatch.setenv("THINKSPC_VAULT_ROOT", str(tmp_path / "vault"))
    spec = importlib.util.spec_from_file_location("session_pointers", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["session_pointers"] = module
    spec.loader.exec_module(module)
    os.makedirs(module.PENDING, exist_ok=True)
    return module


def write_transcript(path, events):
    with open(path, "w") as fh:
        for event in events:
            fh.write(json.dumps(event) + "\n")


def tool_use(name, **inp):
    return {
        "type": "assistant",
        "cwd": "/repo",
        "sessionId": "sid-1234-5678",
        "timestamp": "2026-07-26T04:23:49.261Z",
        "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]},
    }


class TestExtraction:
    def test_splits_reads_from_writes(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [
            tool_use("Read", file_path="/repo/a.ts"),
            tool_use("Edit", file_path="/repo/b.ts"),
        ])
        info = sp.extract(str(t))
        assert "/repo/a.ts" in info["reads"]
        assert "/repo/b.ts" in info["writes"]

    # Bash is ~80% of tool calls and its paths live inside shell strings.
    # Guessing at them would put wrong pointers in the index.
    def test_ignores_bash_and_other_unstructured_tools(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [
            tool_use("Bash", command="cat /repo/secret.ts"),
            tool_use("Grep", path="/repo/src"),
            tool_use("WebSearch", query="/repo/x"),
        ])
        info = sp.extract(str(t))
        assert info["reads"] == {} and info["writes"] == {}

    # One corrupt line must not cost the whole session's pointers.
    def test_survives_malformed_lines(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        with open(t, "w") as fh:
            fh.write("{not json\n")
            fh.write(json.dumps(tool_use("Write", file_path="/repo/a.ts")) + "\n")
            fh.write("\n")
        assert "/repo/a.ts" in sp.extract(str(t))["writes"]

    def test_shallowest_cwd_wins_as_root(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        deep = dict(tool_use("Read", file_path="/repo/frontend/a.ts"), cwd="/repo/frontend")
        write_transcript(t, [deep, tool_use("Read", file_path="/repo/b.ts")])
        info = sp.extract(str(t))
        assert info["roots"][0] == "/repo"


class TestRelativize:
    def test_vault_and_cwd_get_scheme_prefixes(self, sp):
        vault_file = os.path.join(sp.VAULT, "notes/a.md")
        assert sp.relativize(vault_file, ["/repo"]) == "vault://notes/a.md"
        assert sp.relativize("/repo/src/a.ts", ["/repo"]) == "cwd://src/a.ts"

    # A pointer outside both roots is still a real pointer; keeping it absolute
    # is more honest than dropping it or mangling it into a relative path.
    def test_unknown_root_stays_absolute(self, sp):
        assert sp.relativize("/etc/hosts", ["/repo"]) == "/etc/hosts"


class TestRanking:
    def test_most_touched_first_then_alphabetical(self, sp):
        counts = {"/repo/rare.ts": 1, "/repo/hot.ts": 9, "/repo/also.ts": 1}
        assert sp.rank(counts, ["/repo"]) == [
            "cwd://hot.ts",
            "cwd://also.ts",
            "cwd://rare.ts",
        ]

    def test_caps_the_list(self, sp):
        counts = {f"/repo/f{i}.ts": 1 for i in range(sp.MAX_PATHS + 20)}
        assert len(sp.rank(counts, ["/repo"])) == sp.MAX_PATHS


class TestFrontmatter:
    def test_absent_undertaking_key_when_unassigned(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Read", file_path="/repo/a.ts")])
        block = sp.build_frontmatter(sp.extract(str(t)))
        assert "undertaking:" not in block
        assert 'session_id: "sid-1234-5678"' in block

    def test_stamps_pending_assignment(self, sp, tmp_path):
        with open(os.path.join(sp.PENDING, "sid-1234-5678.json"), "w") as fh:
            json.dump({"undertaking": "f9-und-micron", "section": "company-studies"}, fh)
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Read", file_path="/repo/a.ts")])
        block = sp.build_frontmatter(sp.extract(str(t)))
        assert 'undertaking: "f9-und-micron"' in block
        assert 'undertakingSection: "company-studies"' in block

    def test_empty_lists_are_written_explicitly(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Bash", command="ls")])
        block = sp.build_frontmatter(sp.extract(str(t)))
        assert "filesWritten: []" in block and "filesRead: []" in block

    def test_quotes_are_escaped(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Write", file_path='/repo/we"ird.ts')])
        block = sp.build_frontmatter(sp.extract(str(t)))
        assert r'cwd://we\"ird.ts' in block


class TestStamp:
    # The hook fires twice per session (PreCompact, then SessionEnd). A second
    # run must replace the block, not stack another one on top.
    def test_restamping_replaces_rather_than_appends(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Read", file_path="/repo/a.ts")])
        md = tmp_path / "s.md"
        md.write_text("# Claude Code Session\n\nbody\n")

        assert sp.stamp(str(t), str(md)) == "stamped"
        first = md.read_text()

        write_transcript(t, [
            tool_use("Read", file_path="/repo/a.ts"),
            tool_use("Write", file_path="/repo/b.ts"),
        ])
        assert sp.stamp(str(t), str(md)) == "stamped"
        second = md.read_text()

        assert second.count("pointerVersion: 1") == 1
        assert second.endswith("# Claude Code Session\n\nbody\n")
        assert "cwd://b.ts" in second and "cwd://b.ts" not in first

    def test_unchanged_when_nothing_moved(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Read", file_path="/repo/a.ts")])
        md = tmp_path / "s.md"
        md.write_text("body\n")
        sp.stamp(str(t), str(md))
        assert sp.stamp(str(t), str(md)) == "unchanged"

    def test_missing_markdown_is_not_an_error(self, sp, tmp_path):
        t = tmp_path / "t.jsonl"
        write_transcript(t, [tool_use("Read", file_path="/repo/a.ts")])
        assert sp.stamp(str(t), str(tmp_path / "nope.md")) == "missing"
