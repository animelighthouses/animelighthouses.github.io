Shared HTML chunks composed into top-level pages by tools/build-html.mjs.
=========================================================================

Each chunk is content-only — no enclosing element of the chunk is included
unless it is itself part of the chunk (for example, browse-filter-panel.html
contains the full `<div id="filter-panel">…</div>`).

Indentation inside each partial is 2-space relative to column 0. The build
script reads the leading whitespace of the matching `<!-- include: -->`
marker in the host file and prepends it to every line of the partial so the
rendered HTML stays uniformly indented.

Markers in host pages take this paired form (the build script keeps the
markers around the rendered content so future editors can locate the source
file):

    <!-- include: partials/browse-subtitle.html -->
    ... rendered partial content ...
    <!-- /include -->

A bare marker on its own line (no closing `<!-- /include -->`) is also
accepted — the script will fill in the body and add the closer.

Workflow:
  1. Edit a partial in this folder.
  2. Run `npm run build:html` (or `node tools/build-html.mjs`).
  3. Commit the partial AND the regenerated `*.html` files together.

Troubleshooting:
  Host files are normalized to LF before processing. Older builds briefly
  failed on CRLF-only line endings — the matcher then replaced only each
  `<!-- include -->` opener and left duplicate markup + orphaned
  `<!-- /include -->` behind. Fixed in tools/build-html.mjs by tolerating `\r?\n`
  after `include` directives and stripping `\r\n` on read.

Inventory:
  browse-subtitle.html            — Recent / List nav row + burger
  browse-subtitle-no-burger.html  — same row without the burger (about page)
  browse-filter-panel.html        — search + filters + sort dropdown panel
  footer-theme-row.html           — light theme switch row
  footer-links.html               — Home / About nav links wrapper
  submit-subtitle.html            — Sighting / Lighthouse / Home row + login + admin notice
