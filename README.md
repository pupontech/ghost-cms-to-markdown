# Ghost CMS to Markdown

A project for exporting Ghost CMS content into portable, deterministic Markdown.

## Status

Project initialized. The product contract is intentionally not finalized yet. The first Kanban card is the Matt Pocock style grilling pass that will settle the export scope and terminology before implementation.

## Working agreements

This repository follows the Matt Pocock skills workflow:

1. Grill the design frontier and record the shared domain language.
2. Turn the agreed design into a spec.
3. Break the spec into vertical tracer-bullet tickets.
4. Implement with test-driven feedback loops.
5. Run standards and spec review before integration.

The project board is the Hermes Kanban board `ghost-cms-to-markdown`.

## Provisional intent

The eventual tool should provide a safe, repeatable way to move selected Ghost CMS content into a Markdown file tree. The exact source API or export format, supported entities, metadata shape, asset policy, and command-line interface are open decisions tracked on the board.

## Repository layout

- `CONTEXT.md`: provisional domain vocabulary and open decisions.
- `docs/agents/`: agent-facing tracker and domain-document pointers.
- `docs/adr/`: accepted architectural decisions, added as they are made.

## Development

There is no implementation yet. Do not infer the final interface from this scaffold. Start with the design card on the Kanban board.
