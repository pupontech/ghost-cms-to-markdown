# Ghost CMS to Markdown

A credential-free, browser-local converter for Ghost JSON exports. Import an
export from Ghost Admin, select posts or pages, preview the Markdown, and
download individual files or a ZIP archive.

## Use

1. In Ghost Admin, open **Settings → Advanced → Import/Export** and export your
   content.
2. Open the converter and drop the exported JSON file into the page.
3. Select the entries to convert, choose the metadata/front matter options,
   preview the result, and download Markdown or a ZIP archive.

The import, sanitization, conversion, preview, and export steps run in the
browser. The app does not request Ghost credentials, upload content to a
conversion service, or persist the imported export in browser storage.

## Conversion pipeline

Ghost-rendered HTML is sanitized and converted through a syntax-tree pipeline:

```text
HTML → parse5 → HAST → MDAST → GitHub Flavored Markdown
```

The converter preserves headings, titles, formatting, links, lists, code,
blockquotes, tables, image references, media references, and other meaningful
HTML. When Markdown has no equivalent, safe inert HTML is retained rather than
silently discarding semantics. Conversion runs in a Web Worker when available,
with a main-thread fallback.

### Images

Images stay linked to their original Ghost URLs. The app does not download or
put image files inside the Markdown or ZIP export. This keeps exports smaller
and avoids extra downloads, CORS errors, and problems with private image URLs.
Images will display as long as the original Ghost URL is still available.

## Open-source acknowledgements

This project is built on the following open-source projects. Their upstream
licenses and copyright notices remain applicable.

### Ghost and conversion

- [Ghost](https://ghost.org/) — the CMS export format consumed by this app;
  see Ghost's [Import/Export documentation](https://ghost.org/help/imports/).
- [parse5](https://github.com/inikulin/parse5) — HTML5 parsing.
- [hast-util-from-parse5](https://github.com/syntax-tree/hast-util-from-parse5)
  — conversion from the parse5 tree to HAST.
- [hast-util-to-mdast](https://github.com/syntax-tree/hast-util-to-mdast) —
  conversion from HAST to MDAST.
- [mdast-util-gfm](https://github.com/syntax-tree/mdast-util-gfm) — GitHub
  Flavored Markdown extensions, including tables, task lists, and
  strikethrough.
- [mdast-util-to-markdown](https://github.com/syntax-tree/mdast-util-to-markdown)
  — Markdown serialization.
- [hast-util-to-html](https://github.com/syntax-tree/hast-util-to-html) —
  serialization of safe HTML fallbacks.
- [unified](https://unifiedjs.com/) and the [syntax-tree](https://github.com/syntax-tree)
  ecosystem — the syntax-tree foundations used by the conversion pipeline.

### Application and development tooling

- [JSZip](https://github.com/Stuk/jszip) — in-browser ZIP creation.
- [Vite](https://vite.dev/) — development server and production bundling.
- [TypeScript](https://www.typescriptlang.org/) — application language and
  type checking.
- [Vitest](https://vitest.dev/) — automated test runner.
- [jsdom](https://github.com/jsdom/jsdom) — browser-like test environment.

The direct dependency versions and the complete resolved dependency tree are
recorded in [`package.json`](package.json) and [`package-lock.json`](package-lock.json).
The direct packages above are used under their respective upstream licenses:
MIT for the conversion libraries, Vite, Vitest, and jsdom; Apache-2.0 for
TypeScript; and MIT or GPL-3.0-or-later for JSZip.
