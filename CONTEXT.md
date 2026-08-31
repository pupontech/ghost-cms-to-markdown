# Ghost CMS to Markdown: Domain Context

This is a provisional shared language for the project. Terms and decisions become authoritative only after the initial grilling pass records them.

## Core terms

- **Ghost source**: the Ghost installation or source artifact from which content is read.
- **Source entry**: one content item selected for export. Whether this means posts, pages, or additional Ghost entities is not decided.
- **Export selection**: the user-defined set of source entries included in one run.
- **Export job**: one invocation that reads an export selection and writes Markdown outputs.
- **Markdown document**: the portable Markdown representation of one source entry.
- **Front matter**: structured metadata attached to a Markdown document, if the agreed format includes it.
- **Asset**: a non-body file referenced by an exported entry, such as an image or downloadable file.
- **Output tree**: the directory and file naming layout produced by an export job.

## Provisional invariants

These are safe starting constraints, subject to owner review:

- An export job is read-only with respect to the Ghost source.
- Repeating the same export should be deterministic and should not silently delete unrelated local files.
- Credentials and access tokens must not be committed or printed in logs.
- Errors should identify the affected source entry or asset without exposing secrets.

## Open decisions

- Which Ghost input is supported first: Admin API, Content API, Ghost JSON export, or more than one.
- Which entities are supported: posts, pages, tags, authors, settings, and custom fields.
- How authentication is supplied and how access is scoped.
- How Ghost HTML and cards are converted to Markdown.
- The front matter schema and date, slug, tag, author, and visibility conventions.
- The output tree, filename collision behavior, and overwrite policy.
- Whether assets are copied, retained as remote URLs, or handled by a configurable policy.
- Runtime, packaging, and user interface: CLI, library, or both.
- Draft, private, scheduled, and deleted content behavior.

## Decision records

Accepted architectural decisions belong in `docs/adr/`. Until then, this document must not be treated as a final specification.
