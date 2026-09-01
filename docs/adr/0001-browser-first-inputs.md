# ADR 0001: Browser-first Ghost JSON input

- **Status:** Accepted
- **Date:** 2026-08-31

## Decision

The only input is a user-provided Ghost JSON export processed entirely in the browser. The static application accepts no password, token, API key, or other credential, has no runtime API connector, and does not scrape public URLs.

## Rationale

Ghost's export is the owner's official bulk artifact and requires no credential transfer. It supports drafts and private content without asking the user to authenticate to a third-party conversion service. Public scraping and API connectors add network and credential-handling paths that are not required for the core workflow.

## Consequences

Private content can remain on the user's device and the app can be deployed as static assets. Large files require worker-based processing and browser memory limits. A future Admin API integration must be a separately reviewed server-side feature.

See `docs/research/architecture.md` for the evidence record.
