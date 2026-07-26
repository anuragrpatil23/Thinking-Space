# Editor Contract — one CM6 engine, decorations on top (locked 2026-07-17)

Locked technical decision #11. No ProseMirror/Notion block model, ever — markdown+YAML on disk stay byte-identical; richer editing is CM6 decorations (Obsidian Live Preview model) in `MarkdownRichEditorBlock`.

Related: locked decision #10 — markdown file interaction uses one shared orchestrator/provider (`frontend/src/components/orchestrators/MarkdownViewerOrch.tsx`) for both view and edit; avoid page-specific editor overlays.

## Decoration units

- `markdownInlineImageExtensionBlock` — inline image widgets, dimension-cached.
- `markdownSyntaxHidingExtensionBlock` — headings/emphasis/links styled, markers hidden, per-line reveal.
- `markdownTaskCheckboxExtensionBlock` — clickable checkboxes toggle the markdown, rendered hrs.
- `editorLanguageBlock` — extension→grammar routing; markdown decorations mount only for markdown files.

## Code files never go through the prose pipeline

Code files (`kind === 'code'`) never render through the markdown prose pipeline in view mode — that wraps `//` comments/imports as paragraphs and turns backtick strings into inline code. Instead `CodeDocumentViewBlock` mounts a read-only CM6 surface with the same per-language grammar + syntax highlighting (decided 2026-07-17). Edit mode already colors code via `@uiw/react-codemirror` basicSetup (`syntaxHighlighting(defaultHighlightStyle)` on by default) + the grammar extension.

## Live preview + hold-to-edit

Toggle: Settings → Theme → "Live preview while editing" (`livePreviewSyntaxHiding` in `markdownEditorSettingsBlock`, read per decoration pass). With it on, entering editing from view mode is a **long-press on every surface** (mouse and touch): a plain click stays reading, holding ~450ms drops into the editor at the press point (`longPressToEditActive` + pointer handlers in `MarkdownDocumentBlock`; movement/selection cancels; a "Keep holding to edit…" hint pill reveals ~150ms in). The pencil button always stays as the discoverable primary.

Decided 2026-07-17: uniform hold-to-edit kills accidental single-click edits on Electron/desktop and matches the touch gesture — no single-click-to-edit anywhere.

Remaining phases: tables-as-widgets, click-position→cursor mapping, per-profile decoration routing.
