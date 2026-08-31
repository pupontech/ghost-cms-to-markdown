# Ghost CMS to Markdown

A project for exporting Ghost CMS content into portable, deterministic Markdown.

## Status

The v0.1 browser prototype is implemented: it converts Ghost JSON exports locally, with an optional public Ghost Content API connector. The primary workflow does not scrape public sites and does not upload private exports.

## Working agreements

This repository follows the Matt Pocock skills workflow:

1. Grill the design frontier and record the shared domain language.
2. Turn the agreed design into a spec.
3. Break the spec into vertical tracer-bullet tickets.
4. Implement with test-driven feedback loops.
5. Run standards and spec review before integration.

The project board is the Hermes Kanban board `ghost-cms-to-markdown`.

## Product direction

The tool provides a simple **Upload -> Select -> Convert -> Download** flow for Ghost posts and pages. It supports individual Markdown downloads, ZIP export, metadata front matter, allowlisted HTML conversion (including headings, formatting, lists, code, images, tables, blockquotes, and links), search/filter/select, and large-export progress without requiring end users to install software.

The primary workflow is fully client-side: Ghost JSON is parsed and converted in the browser. A secondary Content API workflow reads public posts and pages with a public Content API key and correct pagination. Admin API keys are not accepted by the static app, and public URL scraping is out of scope.

See [`docs/research/architecture.md`](docs/research/architecture.md) for the evidence, approach comparison, data flow, security model, hosting recommendation, and known limitations.

## Repository layout

- `CONTEXT.md`: accepted domain vocabulary and product invariants.
- `docs/agents/`: agent-facing tracker and domain-document pointers.
- `docs/adr/`: accepted architectural decisions.
- `docs/research/`: cited research and architecture findings.

## Development

Development uses Node.js tooling only for maintainers and CI. End users use the deployed static website and need no local runtime. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
