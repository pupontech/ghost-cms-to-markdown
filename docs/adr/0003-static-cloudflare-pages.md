# ADR 0003: Static Cloudflare Pages deployment for v1

- **Status:** Accepted
- **Date:** 2026-08-31

## Decision

Deploy v1 as a Vite-built static site on Cloudflare Pages. Keep JSON parsing, conversion, previews, and ZIP creation in the browser.

## Rationale

The primary workflow needs no database, upload endpoint, or server secret. Static hosting minimizes cost and privacy exposure and avoids serverless request-body and execution limits for large exports.

## Consequences

The shipped site has no runtime network connector, credential input, upload endpoint, or server dependency. A future network connector would need a new ADR covering credential handling, SSRF, rate limiting, retention, and deployment limits before it could be added.
