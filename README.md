# Thinking Space

> **Your AI writes the notes. This is where you think with them.**

[![License: AGPL-3.0 (non-commercial)](https://img.shields.io/badge/License-AGPL--3.0%20(non--commercial)-blue.svg)](LICENSE)
[![Platform: Electron](https://img.shields.io/badge/Platform-Electron%20%7C%20Web%20%7C%20iOS-brightgreen)]()
[![Built with: React + TypeScript](https://img.shields.io/badge/Built%20with-React%20%2B%20TypeScript-61DAFB)]()

---

## Download

- macOS (Apple Silicon): [Thinking Space 2.6.0 arm64 DMG](https://github.com/anuragrpatil23/Thinking-Space/releases/download/v2.6.0/Thinking.Space-2.6.0-arm64.dmg)
- Windows (x64): [Thinking Space 2.6.0 x64 Setup](https://github.com/anuragrpatil23/Thinking-Space/releases/download/v2.6.0/Thinking.Space.Setup.2.6.0-x64.exe)
- iPhone / iPad: not yet distributed — the iOS app (Capacitor) builds from source via Xcode. There is no public install link yet; TestFlight distribution is planned.
- All release assets: [GitHub Releases](https://github.com/anuragrpatil23/Thinking-Space/releases)

---

## What Is This?

At some point I noticed I had stopped writing my own notes. Claude Code writes them now — session logs, research, plans, summaries — and they land as Markdown files in a folder. If you work with an AI seriously, you probably know the feeling: getting thoughts written down is no longer the problem. Keeping up with what got written is. Reading it, seeing what your AI actually did, connecting it to what you already think, deciding what happens next.

Chat isn't the place for that — conversations scroll away, and a pile of transcripts isn't a knowledge base. Notes apps aren't the place either — they all assume the human is the one typing.

So I built the place. Thinking Space points at the folder your AI writes into. You read what it wrote, see which notes each session touched, organize its output next to your own ideas, and hand it the next task. It doesn't replace your AI. It's the desk you both work at.

The trick is boring on purpose: plain Markdown files in a folder are the one thing both you and your AI can read and write natively. Agents already know how to work with files, and you own the files forever. No plugin API, no integrations to maintain, nothing to migrate off of — and it'll work with whatever agent exists next year.

What's inside:

- A chill markdown viewer — point it at a folder and read your notes
- An **AI Activity** dashboard that shows what you actually worked on with Claude, Codex, ChatGPT, Grok — down to which vault notes each session touched
- A **vault graph** that maps your notes and lights up where your AI has been working
- A freeform **home canvas** — post-its, live vault notes, and web widgets on an infinite board
- An **embedded terminal** to run agents (including Claude Code) inside the app — they can even modify and rebuild the app itself, commit to running new build in under 30 seconds
- Agents log their tasks, plans, and handoffs as plain notes in your vault, so their work sits right next to your own thinking
- Works alongside Obsidian — no conflicts; your folder structure stays yours
- Local-first, plain Markdown + YAML, no lock-in to one AI provider
- iOS app that actually opens big vaults. Obsidian on my iPhone usually just spins forever — this one doesn't.

Use an existing notes folder or start a new one (a cloud-synced folder keeps it on all your devices). The code is source-available — read it, change it, have your AI change it for you ([LICENSE](LICENSE)).

Humans are beautiful.

---

## What It Looks Like

<!-- Replace with an actual screen recording when available -->

<p align="center">
  <img src="docs/screenshots/home-dashboard.jpg" alt="Thinking Space home canvas" width="900" />
  <br />
  <em>Home canvas — pixel-art ambient scene, draggable notes/widgets, and the AI Activity dashboard</em>
</p>

<p align="center">
  <img src="docs/screenshots/explorer-workspace.jpg" alt="Thinking Space explorer workspace" width="900" />
  <br />
  <em>Markdown workspace with the local-first explorer and multi-tab desktop shell</em>
</p>

<p align="center">
  <img src="docs/screenshots/organizer-workspace.jpg" alt="Thinking Space organizer workspace" width="900" />
  <br />
  <em>Organizer view for structured thinking and hierarchical knowledge management</em>
</p>

<details>
<summary><strong>Walkthrough</strong></summary>

### 1. Connect a Folder

Point Thinking Space at any folder on your machine — an existing notes vault, an iCloud directory, or a fresh folder. That folder becomes your Thinking Space. Everything is stored as plain Markdown files with YAML frontmatter, so your data is always yours.

### 2. Home Canvas

After connecting, you land on a freeform **home canvas** — an infinite board with a pixel-art ambient scene that greets you by name. Drop **post-its**, pin **live vault notes**, and add **web widgets** with per-tile auto-refresh, then pan/zoom with a minimap. On desktop the canvas is the default home; it doubles as your at-a-glance dashboard.

### 3. AI Activity

A dashboard for what you actually worked on with AI — **sessions, messages, and projects over time** across Claude, Codex, ChatGPT, and Grok, plus a **Reading** source that tracks GoodNotes reading sessions. Filter by source and date range, see a this-week digest, and drill into any day's chains. Activity heatmap, duration trend, and totals views included.

### 4. Thinking Space (Markdown Workspace)

The main workspace is a multi-document markdown editor with:
- A **file explorer** sidebar with folder color coding and icon style options
- **Tabbed editing** — open multiple documents side by side, tabs persist across sessions
- **Conflict-safe saves** with mtime/hash checks so you never lose edits
- **Obsidian wikilink** `[[navigation]]` — click through to linked notes
- **Native LaTeX (KaTeX) and TikZ (TikZJax)** rendering for math and diagrams
- **Ruled notebook** view and multiple reading layouts
- **AI writing actions** — highlight text and get grammar, clarity, structure, or tone suggestions with diff preview

### 5. New Note

Capture a thought quickly with emotion tags, type classification, and optional AI assistance. Notes land in your vault as Markdown files with structured YAML frontmatter.

### 6. AI Chat

Have a conversation with AI models directly inside the app:
- **Multi-provider**: OpenAI, Anthropic Claude, local models (LM Studio / OpenAI-compatible), Codex CLI
- **Streaming responses** with token/latency telemetry
- **Per-scope defaults** — set different models for different tasks

### 7. Thinking Organizer

A hierarchical tree view of your knowledge base: **Programs > Epics > Ideas > Thoughts**. Drag-and-drop to rearrange, create new nodes, reparent items. Hierarchy lives in YAML metadata, not folder structure — so your folders can be organized however you want.

### 8. Built-in Browser & Web

An in-app web browser with:
- **Bookmark management** with groups
- **Google Docs and Sheets** integration via OAuth
- **RSS feed reader** with retention controls, feed groups, and preset tags

### 9. Tools

Navigation folds AI, Web, and the utilities below into a single **Tools** toolbox (jump to any side-rail tab with Cmd/Ctrl + number):
- **Git Insights** — activity heatmap, weekly commit trends, contributor stats
- **PDF to Markdown** — extract content with layout preservation
- **Transcript Cleaner** — heading extraction and normalization
- **Excalidraw++** — full drawing canvas with pen defaults, scene management, and highlighter
- **Mindmap Builder** — convert hierarchical markdown into visual diagrams
- **Password Manager** — cross-device passphrase-encrypted vault

### 10. Schedules

Schedule recurring agent runs with a launchd-direct runner — no always-on server. Create/edit schedules from a sidebar, default new ones to **Claude Code** execution, and watch them via **live log streaming**, a transcript history viewer, and a heartbeat file. Optional **Telegram** resume loop and ntfy failure alerts keep you in the loop when you step away.

### 11. Embedded Terminal

A full VS Code-style terminal (xterm.js + node-pty) as a first-class nav item. Multi-tab, shells stay alive when switching pages. Run Claude Code or any CLI tool directly inside the app.

### 12. Settings

Configure everything: theme, explorer appearance, schedules, AI providers, markdown editor behavior, Google Workspace auth, RSS feeds, cache, and vault switching. A **Developer** tab lets you toggle Live Source Mode and trigger the rebuild pipeline.

</details>

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm (comes with Node.js)

### Using the build script

```bash
git clone https://github.com/anuragrpatil23/Thinking-Space.git
cd Thinking-Space

# Install everything
./build.sh install

# Start the dev server
./build.sh dev
```

Opens at `http://localhost:5173` — pick a local folder as your vault and you're in.

### Other build commands

| Command | What it does |
|---|---|
| `./build.sh dev` | Start Vite dev server |
| `./build.sh web` | Build web/PWA bundle |
| `./build.sh electron` | Build & launch Electron app |
| `./build.sh mac` | Package macOS `.dmg` |
| `./build.sh win` | Package Windows installer |
| `./build.sh win-lite` | Package Windows x64 installer without embedded terminal |
| `./build.sh linux` | Package Linux `.AppImage` |
| `./build.sh ios` | Build for iOS + open Xcode |
| `./build.sh backend` | Start FastAPI backend (optional) |
| `./build.sh test` | Run frontend tests |
| `./build.sh clean` | Remove build artifacts |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Desktop | Electron (via Capacitor) |
| Mobile | Capacitor (iOS) |
| Storage | YAML frontmatter in Markdown files (source of truth) |
| Cache | IndexedDB via Dexie.js (rebuildable) |
| AI | OpenAI, Anthropic, Open Source AI (LM Studio/OpenAI-compatible local), Codex CLI |
| Drawing | Excalidraw |
| Editor | CodeMirror |
| Terminal | xterm.js (`@xterm/xterm`) + node-pty (same stack as VS Code) |
| Backend | FastAPI + Python (optional, thin proxy) |

---

## Architecture

Thinking Space follows a **lego blocks + orchestrators** pattern:

- **Lego blocks** — small, reusable primitives (components, hooks, services)
- **Orchestrators** — page/feature containers that compose blocks and manage state

Data flows through:
1. **Markdown files** with YAML frontmatter (source of truth, portable, git-friendly)
2. **IndexedDB** cache for fast hierarchy queries (rebuildable from files)
3. **Agent CLI** (`thinkspc`) so agents write schema-correct notes into your vault in one command

Hierarchy lives in metadata (`parent` fields), not folder structure — organize your vault however you want.

For detailed architecture docs, see:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system map: processes, trust boundaries, data flow, subsystems
- [DEVELOPMENT.md](DEVELOPMENT.md) — architecture contracts, storage strategy, implementation phases
- [docs/ADR-004-YAML-Architecture.md](docs/ADR-004-YAML-Architecture.md) — full YAML schema
- [docs/ADR-005-Agent-Capabilities.md](docs/ADR-005-Agent-Capabilities.md) — capability system
- [AGENTS.md](AGENTS.md) — agent operating contract

---

## Contributing

Contributions are welcome! The codebase follows strict placement and naming conventions — see [DEVELOPMENT.md](DEVELOPMENT.md) and [AGENTS.md](AGENTS.md) before making changes.

---

## License

AGPL-3.0 for non-commercial use. Commercial license required for any commercial use.

| Use Case | Allowed? |
| --- | --- |
| Personal / research / educational | Yes |
| Self-hosted (non-commercial) | Yes, with attribution |
| Fork and modify (non-commercial) | Yes, share source under AGPL-3.0 |
| Commercial use / SaaS / rebranding | Requires commercial license |

See [LICENSE](LICENSE) for full terms. For commercial licensing, contact the maintainer.

Copyright (C) 2026 Anurag Patil. All rights reserved.
