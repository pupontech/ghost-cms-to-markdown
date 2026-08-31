# ADR 0001: Browser-first Ghost JSON input

- **Status:** Accepted
- **Date:** 2026-08-31

## Decision

The primary input is a user-provided Ghost JSON export processed entirely in the browser. A public Ghost Content API connector is secondary. Public URL scraping is not a product dependency, and Admin API keys are not accepted by the static application.

## Rationale

Ghost's export is the owner's official bulk artifact and requires no credential transfer. The Content API is useful for public convenience but cannot promise drafts or private content. Admin credentials are secret and require a server boundary. Public scraping is theme- and security-dependent.

## Consequences

Private content can remain on the user's device and the app can be deployed as static assets. Large files require worker-based processing and browser memory limits. A future Admin API integration must be a separately reviewed server-side feature.

See `docs/research/architecture.md` for the evidence record.
