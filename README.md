# Thinking Space

> **Your AI writes the notes. This is where you think with them.**

[![License: AGPL-3.0 (non-commercial)](https://img.shields.io/badge/License-AGPL--3.0%20(non--commercial)-blue.svg)](LICENSE)
[![Platform: Electron](https://img.shields.io/badge/Platform-Electron%20%7C%20Web%20%7C%20iOS-brightgreen)]()
[![Built with: React + TypeScript](https://img.shields.io/badge/Built%20with-React%20%2B%20TypeScript-61DAFB)]()

---

## Download

- macOS (Apple Silicon): [Thinking Space 2.8.0 arm64 DMG](https://github.com/anuragrpatil23/Thinking-Space/releases/download/v2.8.0/Thinking.Space-2.8.0-arm64.dmg)
- Windows (x64): [Thinking Space 2.8.0 x64 Setup](https://github.com/anuragrpatil23/Thinking-Space/releases/download/v2.8.0/Thinking.Space.Setup.2.8.0-x64.exe)
- iPhone / iPad: not yet distributed — the iOS app (Capacitor) builds from source via Xcode. There is no public install link yet; TestFlight distribution is planned.
- All release assets: [GitHub Releases](https://github.com/anuragrpatil23/Thinking-Space/releases)

---

## What Is This?

At some point I noticed I had stopped writing my own notes. Claude Code writes them now — session logs, research, plans, summaries, the occasional HTML report or diagram — and they all land as files in a folder. If you work with an AI seriously, you probably know the feeling: producing the words got cheap. The AI writes faster than you can absorb. The slow part now — the part that actually gates what you can do next — is understanding what got written: reading it, seeing what your AI actually did, connecting it to what you already think, deciding what happens next.

And understanding has a second problem: it doesn't keep. You work something out forty minutes into a session, close the tab, and it's gone — next time, you and the AI both start over from zero. Chat isn't built to hold it; conversations scroll away, and a pile of transcripts isn't a knowledge base. Notes apps aren't built for it either — they all assume the human is the one typing.

So I built the thing that was missing. Thinking Space points at the folder your AI writes into. You read what it wrote, see which notes each session touched, organize its output next to your own ideas, and hand it the next task. Because everything the two of you work out lives in that folder — the notes, the decisions, the trail of which session touched what — the next session picks up where the last one actually ended, instead of starting over. That cuts both ways: you stop re-reading old ground, and the AI stops re-deriving it — an agent that opens the trail starts already knowing what was decided, so it spends its context on the new problem instead of reconstructing the old one. Understanding stops being something you rebuild and starts being something you accumulate. It doesn't replace your AI. It's the desk you both work at, and the desk keeps everything on it.

The trick is boring on purpose: plain files in a folder — Markdown at the core — are the one thing both you and your AI can read and write natively. Agents already know how to work with files, and you own the files forever — and "forever" is not a figure of speech here: plain text is the one format that has outlived every app that ever wrote it, and a text file saved today will still open on whatever computers look like a hundred years from now. No plugin API, no integrations to maintain, nothing to migrate off of — it'll work with whatever agent exists next year, and it'll still be readable long after this app is gone.

**Understanding is built in the session, thinking it through with your AI. Thinking Space is what keeps it — so the next session starts smarter, for both of you.**

So what's inside is the toolset for that loop — see what got built, keep it, pick it back up — plus a way to add any tool that turns out to be missing:

- **AI Activity** — what you actually worked on with Claude, Codex, ChatGPT, and Grok, read straight from the transcripts already on your machine, down to which vault notes each session touched
- **Vault graph** — a live map of your notes and the links between them, with a lens that lights up where your AI has been working
- **Document workspace** — tabbed reading and editing for whatever lands in the folder: Markdown with `[[wikilinks]]` and LaTeX, but also the HTML reports, PDFs, images, CSVs, and Excalidraw drawings your AI produces. Conflict-safe saves mean you and an agent can edit the same vault without stomping each other, and highlighting any text gets you AI writing actions with a diff preview. And it's properly multi-window: every new window is a full workspace, not a pop-out — spread the vault across as many screens as you have
- **Thinking Organizer** — a Programs → Epics → Ideas → Thoughts tree driven by YAML metadata, so your folder structure stays whatever you want it to be
- **Home canvas** — an infinite board of post-its, live vault notes, and web widgets; the at-a-glance start of the day
- **Agent trail** — agents log their tasks, plans, and handoffs as plain notes in your vault (via a one-command CLI), so their work sits right next to your own thinking
- **Schedules** — recurring agent runs that fire whether the app is open or not, with live logs and an optional Telegram loop so a scheduled agent can reach you on your phone
- **Fork + rebuild** — when a tool you need doesn't exist yet, your agent changes the app's own source and the new build is installed and running in under 30 seconds, previous build kept as a backup

And the foundation under all of it: local-first, plain Markdown + YAML, no lock-in to any AI provider. Works alongside Obsidian without conflicts. There's an iOS app, and it actually opens big vaults — Obsidian on my iPhone usually just spins forever; this one doesn't.

Use an existing notes folder or start a new one (a cloud-synced folder keeps it on all your devices). The code is source-available — read it, change it, have your AI change it for you ([LICENSE](LICENSE)).

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
  <em>The markdown workspace — file explorer and tabs</em>
</p>

<p align="center">
  <img src="docs/screenshots/organizer-workspace.jpg" alt="Thinking Space organizer workspace" width="900" />
  <br />
  <em>The organizer — the Programs → Epics → Ideas → Thoughts tree</em>
</p>

<details>
<summary><strong>Walkthrough</strong></summary>

### 1. Point it at a folder

Any folder — your existing notes vault, an iCloud directory, a fresh empty one. That folder is the whole data model: plain Markdown files with YAML frontmatter. If your AI already writes there (Claude Code project notes, session logs, research), everything below works immediately — it's all just reading the same files.

### 2. See what your AI did — AI Activity

This is the view I open every morning. Sessions, messages, and projects over time across Claude, Codex, ChatGPT, and Grok — read straight from the transcripts already on your machine, nothing to configure. Drill into any day, open any session, and see **which vault notes it actually touched**. There's also a reading tracker (GoodNotes) if you opt in.

### 3. See where it worked — Vault Graph

A force-directed map of your whole vault: notes, links between them, and an AI-activity lens that lights up the notes your AI has been working in. Pick a day and watch that day's touched notes glow; click a session and the graph zooms to what it changed. This is the "what has my AI been doing in here?" view.

### 4. Read and write — the document workspace

Tabbed, multi-document reading and editing for whatever your AI leaves in the folder — Markdown, HTML reports, PDFs, images, CSVs, Excalidraw drawings. For Markdown: Obsidian-style `[[wikilinks]]`, LaTeX and TikZ rendering, a ruled notebook view, and conflict-safe saves (mtime/hash — an agent and you editing the same vault won't stomp each other). Highlight any text for AI writing actions — grammar, clarity, structure, tone — with a diff preview before anything changes. It's also properly multi-window: every new window is a complete workspace onto the same vault, so reference material can live on one screen while you write on another.

### 5. Organize the thinking — Thinking Organizer

A tree of Programs → Epics → Ideas → Thoughts, driven by YAML metadata rather than folder structure, so your folders stay however you like them. Drag to rearrange, reparent freely. This is also where agent work shows up: when an agent logs a task, plan, or handoff (they write plain notes via a small CLI), it appears here next to your own items.

### 6. Let it change the app — fork + rebuild

You run your agent wherever you already run it — Thinking Space doesn't care. But it can point at your own fork of its source, so when you want something the app doesn't do, your agent changes the code, and the new build is installed and running in under 30 seconds after the commit. The previous build is kept as a backup, so a bad change can't strand you.

### 7. Put them on a timer — Schedules

Recurring agent runs via launchd — no server, fires whether the app is open or not. Default executor is Claude Code; watch runs through live log streaming and a transcript history. Optional Telegram loop so a scheduled agent can ask you something and get your answer from your phone.

### 8. Start the day — Home Canvas

An infinite board with a pixel-art scene that greets you by name. Post-its, live vault notes, web widgets with auto-refresh. On desktop it's the default home — an at-a-glance dashboard you arrange yourself.

### 9. Everything else

- **New Note** — quick capture with emotion tags and type classification, lands as clean YAML-frontmatter Markdown
- **AI Chat** — multi-provider (Anthropic, OpenAI, local models via LM Studio/OpenAI-compatible, Codex CLI), streaming, per-task model defaults
- **Web** — built-in browser with bookmarks, Google Docs/Sheets via OAuth, and an RSS reader
- **Tools** — Git insights, PDF→Markdown, transcript cleaner, Excalidraw drawing canvas, mindmap builder, an encrypted password manager
- **Settings → Developer** — point the app at your fork of its own source and rebuild it from inside itself

</details>

---

## Quick Start

**Just want to use the app?** Grab the [download](#download) above — no build needed.

**Want to run or change it from source?** The easiest way is to hand it to your agent. Paste this into Claude Code (or any coding agent):

> Clone https://github.com/anuragrpatil23/Thinking-Space, read docs/ARCHITECTURE.md and docs/CODEBASE-GUIDE.md, then run `./build.sh install` and `./build.sh dev` and tell me when it's up.

That's the whole quick start. The repo carries its own onboarding docs ([ARCHITECTURE](docs/ARCHITECTURE.md) → [CODEBASE-GUIDE](docs/CODEBASE-GUIDE.md) → [PLAYBOOKS](docs/PLAYBOOKS.md)), so your agent arrives knowing where everything is and how changes are supposed to be made. If you're already running the app and want to modify it, there's a guided path for that too — your agent forks the repo for you and installs its own builds ([PLAYBOOKS §12](docs/PLAYBOOKS.md)).

<details>
<summary><strong>Doing it by hand anyway</strong></summary>

Prerequisites: [Node.js](https://nodejs.org/) ≥ 22 (the Capacitor CLI requires it) and npm.

```bash
git clone https://github.com/anuragrpatil23/Thinking-Space.git
cd Thinking-Space
./build.sh install   # install everything
./build.sh dev       # dev server at http://localhost:5173
```

| Command | What it does |
|---|---|
| `./build.sh dev` | Start Vite dev server |
| `./build.sh web` | Build web/PWA bundle |
| `./build.sh electron` | Build & launch Electron app |
| `./build.sh mac` / `win` / `linux` | Package installers per platform |
| `./build.sh win-lite` | Windows x64 lite build |
| `./build.sh ios` | Build for iOS + open Xcode |
| `./build.sh typecheck` / `test` | Type check / run tests |
| `./build.sh clean` | Remove build artifacts |

</details>

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
| Backend | FastAPI + Python (optional, thin proxy) |

---

## How It's Built

The short version, because the details live in the docs:

- **Your data is just files.** Markdown with YAML frontmatter, in your folder. The app keeps an IndexedDB cache for fast queries, but it's disposable — it can always be rebuilt from the files. There's no database and no server.
- **Hierarchy lives in metadata** (`parent` fields in the frontmatter), not in folder structure — so you can organize your folders however you want and nothing breaks.
- **The renderer is treated as untrusted.** It displays your notes and webviews, so it runs fully sandboxed; every file operation goes through the main process, which only ever touches the vault folder you chose. On macOS that means the app asks for permission to exactly one folder — yours — and nothing else.
- **The code is organized so an AI can work on it.** Small reusable blocks + feature orchestrators, strict naming, and onboarding docs written for agents: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the system map), [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md) (where everything lives), [docs/PLAYBOOKS.md](docs/PLAYBOOKS.md) (step-by-step recipes for common changes). An agent that reads those three knows where things go and how changes are supposed to be made.
- **Agents get a tiny CLI** (`thinkspc`) to write schema-correct notes into your vault in one command — that's how their tasks, plans, and handoffs show up in the organizer.

---

## Contributing

The intended way to change this app — whether for yourself or to contribute back — is to have your AI do it with you: fork the repo, point your agent at the three docs above, make the change, and open a PR. That's how this repo gets built day to day anyway — most commits here were written by an agent.

A small set of security-critical files (the sandbox, the vault path guard, the credential stores) carry warning headers and require maintainer review on PRs — everything else is fair game. Conventions are enforced by the docs, not tribal knowledge.

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
