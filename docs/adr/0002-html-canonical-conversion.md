# ADR 0002: HTML is the canonical conversion input

- **Status:** Accepted
- **Date:** 2026-08-31

## Decision

When available, Ghost-rendered HTML is the canonical input to the Markdown converter. The v0.1 browser adapter implements this HTML path only and reports an explicit per-entry error when HTML is absent. Markdown card payloads, Lexical, and Mobiledoc fallbacks are deferred until they have dedicated adapters and fidelity tests.

## Rationale

The Content API exposes HTML, the Admin API can request HTML with Lexical, and Ghost maintains official renderers for Lexical and Mobiledoc. Using rendered HTML keeps card rendering and editor-version details at the Ghost boundary while allowing a focused browser conversion engine.

## Consequences

The v0.1 converter uses a dependency-light parse5 allowlist and deterministic Markdown renderer, including common GFM-compatible tables and strikethrough output. Future card/editor adapters must use safe HTML fallbacks or visible warnings; unknown source nodes must not silently disappear.
