# ADR 0004: Keep asset references external by default

- **Status:** Accepted
- **Date:** 2026-08-31

## Decision

Markdown output preserves image, audio, video, file, and embed URLs as external references. v1 does not download remote assets automatically.

## Rationale

The owner brief prioritizes private-content safety and reliable large exports. Downloading assets introduces SSRF, CORS, rate-limit, storage, and ZIP-size concerns. Ghost's export model also treats media as a separate concern.

## Consequences

The output is fast and does not require server fetching, but it may depend on the Ghost site remaining available. Asset downloading can be added later as a separately secured opt-in workflow.
