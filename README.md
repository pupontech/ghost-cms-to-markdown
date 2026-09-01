# Ghost CMS to Markdown

A project for exporting Ghost CMS content into portable, deterministic Markdown.

## Status

The v0.1 browser prototype is implemented: it converts Ghost JSON exports locally with no login, password, token, or API-key input. The app does not scrape public sites or upload private exports; only the static HTML/CSS/JavaScript assets load from the hosting origin.

## Working agreements

This repository follows the Matt Pocock skills workflow:

1. Grill the design frontier and record the shared domain language.
2. Turn the agreed design into a spec.
3. Break the spec into vertical tracer-bullet tickets.
4. Implement with test-driven feedback loops.
5. Run standards and spec review before integration.

The project board is the Hermes Kanban board `ghost-cms-to-markdown`.

## Product direction

The tool provides a simple **Upload -> Select -> Convert -> Preview -> Download** flow for Ghost posts and pages. It supports individual Markdown downloads, ZIP export, metadata front matter, allowlisted HTML conversion (including headings, formatting, lists, code, images, tables, blockquotes, and links), search/filter/select, and large-export progress without requiring end users to install software.

The workflow is fully client-side: Ghost JSON is parsed and converted in the browser. The static app has no credentialed API workflow, no server upload endpoint, and no public URL scraping path. Static assets may be requested from the hosting origin, and browser download actions remain local.

See [`docs/research/architecture.md`](docs/research/architecture.md) for the evidence, approach comparison, data flow, security model, hosting recommendation, and known limitations.

## Repository layout

- `CONTEXT.md`: accepted domain vocabulary and product invariants.
- `docs/agents/`: agent-facing tracker and domain-document pointers.
- `docs/adr/`: accepted architectural decisions.
- `docs/research/`: cited research and architecture findings.

## Development

Development uses Node.js tooling only for maintainers and CI. End users use the deployed static website and need no local runtime. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
