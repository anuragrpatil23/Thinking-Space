# foliate-js (vendored)

EPUB engine for the EPUB reader (`EpubDocumentBlock`).

- Upstream: https://github.com/johnfactotum/foliate-js
- Pinned commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- License: MIT (`LICENSE`)

Only the files the EPUB path reaches are copied. Not vendored: `pdf.js` and
`vendor/pdfjs/` (13 MB; PDFs have their own reader), `reader.js`/`reader.html`
(demo app), `opds.js`, `dict.js`, `footnotes.js`, `quote-image.js`, `ui/`.

## Local patches

- `view.js` `makeBook`: the PDF branch throws `UnsupportedTypeError` instead of
  importing `./pdf.js`.
- `paginator.js` `#top` grid: the two outer tracks read
  `var(--ts-outer-gap, var(--_half-gap))` instead of `var(--_half-gap)`.
  Upstream ties a page's outer margin to twice its inner one; the variable
  (inherited from the host element, unset = upstream behaviour) lets
  `EpubDocumentBlock` widen the gutter at the spine without pushing the text
  further from the book's outer edges.
- `paginator.js` `View.expand()`: returns when `this.document` is null. Each
  section calls `doc.fonts.ready.then(() => this.expand())` and observes
  resizes; either can fire after the section was destroyed (a chapter change
  while fonts load), and upstream then throws "Cannot destructure property
  'documentElement' from null" as an unhandled rejection (seen on iPad,
  2026-11-27).

## Security

Book content can contain scripts. foliate-js renders sections in iframes with
`sandbox="allow-same-origin allow-scripts"` (WebKit needs `allow-scripts` for
event listeners), so the sandbox blocks nothing. Scripts are stopped by
`epubContentGuardBlock.ts`, which strips them and injects a `script-src 'none'`
CSP into every section before it is turned into a blob. See
docs/contracts/SECURITY.md.

To update: copy the same file list from a newer upstream commit, re-apply the
patches above, update the pinned commit here.
