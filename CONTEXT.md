# Ghost CMS to Markdown: Domain Context

This is the shared language for the project. The product brief and the cited research in `docs/research/architecture.md` establish the current contract. New behavior that changes these invariants requires an ADR.

## Core terms

- **Ghost source**: either an owner-provided Ghost JSON export or a public Ghost Content API connection.
- **Source entry**: one Ghost post or page available to the current import method.
- **Export selection**: the user-defined set of source entries included in one browser conversion run.
- **Conversion run**: one invocation that reads an export selection and produces Markdown documents and optional ZIP output.
- **Markdown document**: the portable Markdown representation of one source entry.
- **Front matter**: structured metadata attached to a Markdown document, if the agreed format includes it.
- **Asset reference**: a non-body URL referenced by an entry, such as an image or downloadable file. v1 keeps references external.
- **Output tree**: the virtual directory and file naming layout inside a ZIP download.
- **Conversion warning**: a non-fatal notice that a source feature was preserved with a fallback or could not be represented exactly.

## Accepted invariants

These are accepted constraints:

- A conversion run is read-only with respect to the Ghost source.
- Repeating the same conversion is deterministic and does not modify the Ghost source or unrelated local files.
- Credentials and access tokens must not be committed or printed in logs.
- Errors should identify the affected source entry or asset without exposing secrets.
- The browser-local JSON workflow is the primary path and does not upload content.
- The Content API connector handles pagination and only promises public posts and pages.
- Admin API keys are server-only and are not accepted by the static application.
- Public-site scraping and anti-bot bypasses are not part of the product.
- In v0.1, HTML is sanitized and converted; entries that only provide unsupported editor payloads fail with an explicit error. A future card/editor fallback must preserve content or report a warning rather than silently delete it.
- Remote images and other assets remain external URLs by default.
- YAML front matter is the default and can be disabled or field-selected.

## Current scope

- JSON uploads can include posts, pages, drafts, scheduled entries, private entries, tags, authors, and relation rows when the export contains them. Unrelated Ghost collections are ignored.
- The Content API connector imports public posts and pages only, with authors and tags where available.
- HTML is the canonical and currently implemented conversion input. Entries without usable HTML fail explicitly; Markdown card payloads, Lexical, and Mobiledoc fallbacks are planned rather than silently assumed.
- Markdown files use collision-safe slug-derived names and optional YAML front matter.
- ZIP output uses `ghost-markdown-export/posts/` and `ghost-markdown-export/pages/` paths, with external asset URLs by default.
- Deleted entries are not expected in normal exports; if present, they remain visible as source entries with their status rather than being silently dropped.

## Decision records

Accepted architectural decisions belong in `docs/adr/`. The research record is not a substitute for an ADR; it explains the evidence behind the current decisions.
