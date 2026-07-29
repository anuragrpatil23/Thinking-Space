#!/usr/bin/env python3
"""Extract structured pointers from a Claude Code transcript onto its raw session.

The Thinking Organizer is a book index over the vault. An index entry is only
worth consulting if it carries page numbers, and here the page numbers are file
paths. Those paths exist structurally in exactly one place — the `.jsonl`
transcript's `tool_use` events. Once a session has been rendered to prose they
survive only as text inside fenced JSON blocks, where recovering them is
inference rather than extraction.

So they get lifted here and written as YAML frontmatter on the rendered
raw-session markdown, which is what the app's chain-digest generator reads.

Two modes:

    session-pointers.py stamp <transcript.jsonl> <raw-session.md>
        One session. Called by the render hook after it writes the markdown.

    session-pointers.py backfill [--limit N] [--dry-run]
        Walk every transcript under ~/.claude/projects and stamp whichever
        raw sessions already exist. Idempotent.

Never fails loudly: the render hook must not break a session because pointer
extraction hit something unexpected.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

VAULT = os.environ.get(
    "THINKSPC_VAULT_ROOT",
    os.path.expanduser(
        "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Long-Term-Memory-iCloud"
    ),
)
RAW_SESSIONS = os.path.join(VAULT, "ai-activity", "raw-sessions", "claude-code")
PENDING = os.path.join(VAULT, "ai-activity", "pending-assignments")
TRANSCRIPTS = os.path.expanduser("~/.claude/projects")

# Structured tools only. Bash is ~80% of all tool calls and its paths live
# inside shell strings; guessing at them would put wrong pointers in the index,
# which is worse than having none. An empty list is an honest empty list.
READ_TOOLS = {"Read", "NotebookRead"}
WRITE_TOOLS = {"Edit", "Write", "NotebookEdit", "MultiEdit"}
PATH_KEYS = ("file_path", "notebook_path", "path")

# A long session can touch hundreds of files. The index needs the ones worth
# following, not a filesystem dump — and an unbounded list would dominate the
# chain file it eventually lands in.
MAX_PATHS = 80


def read_events(transcript: str):
    with open(transcript, "r", errors="ignore") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except Exception:
                continue


def extract(transcript: str) -> dict:
    """Pull session id, working roots, and touched paths out of a transcript."""
    session_id = ""
    git_branch = ""
    started = ""
    cwds: dict[str, int] = {}
    reads: dict[str, int] = {}
    writes: dict[str, int] = {}

    for event in read_events(transcript):
        session_id = session_id or str(event.get("sessionId") or "")
        git_branch = git_branch or str(event.get("gitBranch") or "")
        ts = event.get("timestamp")
        if not started and isinstance(ts, str):
            started = ts[:10]
        cwd = event.get("cwd")
        if isinstance(cwd, str) and cwd.startswith("/"):
            cwds[cwd] = cwds.get(cwd, 0) + 1
        if event.get("type") != "assistant":
            continue
        content = (event.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for chunk in content:
            if not isinstance(chunk, dict) or chunk.get("type") != "tool_use":
                continue
            name = chunk.get("name") or ""
            bucket = writes if name in WRITE_TOOLS else reads if name in READ_TOOLS else None
            if bucket is None:
                continue
            inp = chunk.get("input")
            if not isinstance(inp, dict):
                continue
            for key in PATH_KEYS:
                value = inp.get(key)
                if isinstance(value, str) and value:
                    bucket[value] = bucket.get(value, 0) + 1
                    break

    # The deepest cwd wins as the project root, so a session that dipped into
    # `<repo>/frontend` still relativizes against `<repo>`.
    roots = sorted(cwds, key=len)
    return {
        "session_id": session_id,
        "git_branch": git_branch,
        "started": started,
        "roots": roots,
        "reads": reads,
        "writes": writes,
    }


def relativize(path: str, roots: list[str]) -> str:
    """Root-relative so pointers survive a move to another machine."""
    if not path.startswith("/"):
        return path
    if path.startswith(VAULT + "/"):
        return "vault://" + path[len(VAULT) + 1 :]
    for root in roots:
        if path.startswith(root + "/"):
            return "cwd://" + path[len(root) + 1 :]
    return path


def rank(counts: dict[str, int], roots: list[str]) -> list[str]:
    """Most-touched first, then alphabetical — a stable, meaningful order."""
    seen: dict[str, int] = {}
    for raw, n in counts.items():
        key = relativize(raw, roots)
        seen[key] = seen.get(key, 0) + n
    ordered = sorted(seen.items(), key=lambda kv: (-kv[1], kv[0]))
    return [p for p, _ in ordered[:MAX_PATHS]]


def pending_undertaking(session_id: str) -> dict:
    """The end-of-session ask lands here, keyed on session id.

    It cannot be keyed on chainKey: the chain does not exist yet when the ask
    fires — it is generated afterwards, by this very pipeline.
    """
    path = os.path.join(PENDING, f"{session_id}.json")
    try:
        with open(path) as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_frontmatter(info: dict) -> str:
    reads = rank(info["reads"], info["roots"])
    writes = rank(info["writes"], info["roots"])
    assignment = pending_undertaking(info["session_id"]) if info["session_id"] else {}

    lines = ["---", "pointerVersion: 1", f"session_id: {quote(info['session_id'])}", "source: claude-code"]
    if info["started"]:
        lines.append(f"started: {quote(info['started'])}")
    if info["roots"]:
        lines.append(f"cwd: {quote(info['roots'][0])}")
    if info["git_branch"]:
        lines.append(f"gitBranch: {quote(info['git_branch'])}")

    for label, paths in (("filesWritten", writes), ("filesRead", reads)):
        if not paths:
            lines.append(f"{label}: []")
            continue
        lines.append(f"{label}:")
        lines.extend(f"  - {quote(p)}" for p in paths)

    # Written only when the ask actually happened. An absent key means
    # unassigned; an empty string would look like a deliberate blank.
    key = str(assignment.get("undertaking") or "")
    if key:
        lines.append(f"undertaking: {quote(key)}")
        title = str(assignment.get("newTitle") or "")
        section = str(assignment.get("section") or "")
        if title:
            lines.append(f"undertakingTitle: {quote(title)}")
        if section:
            lines.append(f"undertakingSection: {quote(section)}")

    lines.append("---")
    return "\n".join(lines) + "\n"


FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)


def stamp(transcript: str, markdown: str, dry_run: bool = False) -> str:
    info = extract(transcript)
    block = build_frontmatter(info)
    try:
        with open(markdown, "r", errors="ignore") as fh:
            body = fh.read()
    except FileNotFoundError:
        return "missing"

    # Replace our own block rather than appending a second one — the hook runs
    # twice per session (PreCompact, then SessionEnd).
    stripped = FRONTMATTER_RE.sub("", body, count=1)
    updated = block + stripped
    if updated == body:
        return "unchanged"
    if not dry_run:
        with open(markdown, "w") as fh:
            fh.write(updated)
    return "stamped"


def raw_session_for(session_id: str) -> str | None:
    matches = glob.glob(os.path.join(RAW_SESSIONS, f"*_{session_id[:8]}*.md"))
    return matches[0] if matches else None


def backfill(limit: int | None, dry_run: bool) -> int:
    transcripts = sorted(
        glob.glob(os.path.join(TRANSCRIPTS, "*", "*.jsonl")),
        key=os.path.getmtime,
        reverse=True,
    )
    if limit:
        transcripts = transcripts[:limit]
    tally: dict[str, int] = {}
    for transcript in transcripts:
        session_id = os.path.basename(transcript)[: -len(".jsonl")]
        markdown = raw_session_for(session_id)
        if not markdown:
            tally["no-raw-session"] = tally.get("no-raw-session", 0) + 1
            continue
        try:
            result = stamp(transcript, markdown, dry_run=dry_run)
        except Exception as exc:  # never let one bad transcript stop the sweep
            result = f"error:{type(exc).__name__}"
        tally[result] = tally.get(result, 0) + 1
    for key in sorted(tally):
        print(f"{tally[key]:5}  {key}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    one = sub.add_parser("stamp")
    one.add_argument("transcript")
    one.add_argument("markdown")
    one.add_argument("--dry-run", action="store_true")

    many = sub.add_parser("backfill")
    many.add_argument("--limit", type=int, default=None)
    many.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    if args.cmd == "stamp":
        print(stamp(args.transcript, args.markdown, dry_run=args.dry_run))
        return 0
    return backfill(args.limit, args.dry_run)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        # The render hook calls this. A pointer-extraction failure must never
        # cost the user their session capture.
        print(f"session-pointers: {exc}", file=sys.stderr)
        sys.exit(0)
