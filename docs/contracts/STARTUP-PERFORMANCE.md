# Startup Performance Contract (Enforced)

- Heavy vendors (Excalidraw, pdfjs/react-pdf, CodeMirror, recharts) must never be statically reachable from the app entry. They load through code-split boundaries:
  - `MarkdownDocumentLazyBlock` — the only way eager code may mount `MarkdownDocumentBlock` (pulls CodeMirror + pdfjs + Excalidraw + markdown/katex pipeline).
  - `MarkdownRichEditorLazyBlock` — the only way eager code may mount the CodeMirror editor.
  - Chart blocks (`DashboardChartsBlock`, `AiActivity*Block`, `CodexUsageMetricChartBlock`) are `lazy()`-imported at each consumer.
- Do NOT list lazy-only vendors in `vite.config.ts` `manualChunks` — object-form manualChunks forces those chunks into the entry's static import graph (side-effect ordering), silently re-eagerizing them. Only startup vendors (react, dexie) belong there.
- Verify after touching imports: `BUILD_TARGET=electron npx vite build`, then check `dist/index.html` modulepreload list — it must contain only `vendor-react` and `vendor-dexie`. Startup JS payload budget: ≤ 2.4 MB (was 5.24 MB before 2026-07 startup-perf pass, −56%).
