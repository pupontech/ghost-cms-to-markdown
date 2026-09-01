# Ghost CMS to Markdown: implementation spec

## Problem statement

People who own Ghost sites need portable standard Markdown, including metadata and bulk selections, but should not need to install a runtime or expose private content to a conversion service. Public-site scraping is unreliable and is not an acceptable source of truth.

## Solution

A static web application provides one simple flow: **Upload -> Select -> Convert -> Preview -> Download**. The browser accepts a Ghost JSON export, normalizes posts and pages, converts content to Markdown, shows a preview, and downloads one `.md` file or a ZIP. There is no API connector, credential input, URL scraper, or server upload endpoint.

## User stories

1. As a Ghost owner, I want to upload the JSON export I created in Ghost so that I can convert private and draft content without giving a service my password.
2. As a first-time user, I want a clear explanation that conversion happens in my browser so that I understand the privacy boundary.
3. As a user, I want the app to validate the upload before processing so that malformed or wrong files produce a useful message.
4. As a user, I want to see posts and pages with title, type, status, author, publication date, and slug so that I can select the right entries.
5. As a user, I want to search and filter entries so that a large export remains manageable.
6. As a user, I want to select one, many, all, published, or draft entries so that I can control the conversion set.
7. As a user, I want supported HTML formatting, lists, code, images, tables, links, and blockquotes converted to standard Markdown so that the output is portable.
8. As a user, I want entries without an implemented content representation to fail explicitly rather than silently losing content. Future card/editor fallbacks must preserve safe HTML with warnings.
9. As a user, I want optional YAML front matter with configurable fields so that the files fit my destination tool.
10. As a user, I want safe slug-based filenames with deterministic collision handling so that the ZIP can be extracted on Windows and Unix systems.
11. As a user, I want a Markdown preview before downloading so that I can catch conversion issues.
12. As a user, I want one Markdown file or a ZIP of selected files so that I can use the result immediately.
13. As a user with thousands of entries, I want progress and per-entry errors so that one corrupt entry does not abort the whole run.
14. As a privacy-conscious user, I want no content, credential, or export persisted by default so that closing the page ends the working session.
15. As an operator, I want the app to be deployable as static assets so that production does not need a database or upload service.

## Implementation decisions

### Modules and interfaces

- **Export parser**: accepts an unknown JSON value, validates the Ghost export envelope, maps relations, and returns normalized post/page entries or a user-facing import error.
- **Content normalizer**: v0.1 accepts rendered HTML and reports a clear no-content error otherwise. Markdown card content, Lexical, and Mobiledoc are planned adapters, not implicit fallbacks.
- **Markdown converter**: accepts sanitized HTML plus conversion options and returns deterministic Markdown and warnings. It uses a parse5 tree allowlist and an in-repository renderer for common block, inline, table, image, and code elements.
- **Front matter serializer**: accepts normalized metadata and selected fields and returns YAML front matter with safe quoting and Unicode preservation.
- **Filename allocator**: accepts entries and returns deterministic, collision-free filenames under a safe character and length policy.
- **Conversion worker**: accepts normalized entries and options, emits progress/result/error messages, and creates ZIP output without blocking the UI thread.
- **Download adapter**: accepts a Blob and filename and performs only a browser download side effect.

### Input contract

The JSON parser recognizes the Ghost database export shape: `db[]`, bundle `meta`, and bundle `data`. It reads `posts`, `tags`, `users`, `posts_tags`, and `posts_authors`. It ignores unrelated collections. It supports `type: post` and `type: page`; unknown types stay visible as skipped entries with a reason rather than being silently treated as posts.


### Conversion contract

The v0.1 converter accepts non-empty `html`, sanitizes it before conversion, and preserves external asset references as Markdown URLs. If `html` is absent or sanitizes to no content, the entry receives an explicit isolated failure. Markdown fields, Lexical/Mobiledoc fallbacks, and card-specific preservation remain follow-up work.

### Output contract

A Markdown file contains optional YAML front matter followed by a normalized Markdown body. Single-file downloads use the allocated filename. ZIP downloads contain `ghost-markdown-export/posts/` and `ghost-markdown-export/pages/`. No remote media is downloaded in v1.

### Failure contract

Import errors are concise and actionable. Entry-level errors are isolated and included in the result summary. A conversion run may succeed with warnings. Empty selections, duplicate slugs, missing metadata, unsupported types, no-content entries, malformed export bundles, oversized input, and worker failures have explicit UI states.

### Security contract

The static app accepts no password, token, API key, or other credential. It enforces file and output limits, parses with a strict allowlist, sanitizes all preview/fallback HTML, does not persist content, and sends no content to third parties. It has no user-data network connector or upload endpoint; normal same-origin static asset loading is permitted by the CSP. Any future server connector is a separate ADR and must include SSRF, secret-lifetime, rate-limit, and audit-log controls before implementation.

## Testing decisions

Test public module seams, not implementation details:

- Parser tests use independent Ghost-shaped fixtures for current `db` exports, relation joins, missing fields, and malformed input; older editor payloads are covered as explicit no-content cases until adapters land.
- Converter tests cover supported formatting, nested lists, code, images, tables, blockquotes, safe URLs/HTML, Unicode, RTL text, empty content, and long content. Card-specific preservation is a follow-up test target.
- Filename tests cover Windows-reserved characters, Unicode, long slugs, empty slugs, and deterministic duplicates.
- Worker tests verify progress, independent failures, deterministic output, and ZIP structure.
- Browser smoke tests cover Upload -> Select -> Convert -> Preview -> Download and the no-credential UI boundary.

Every new behavior starts with a failing test, then the minimum implementation, then refactoring after green. Large fixture tests are separated from fast unit tests but run in CI.

## Out of scope

- Scraping public Ghost pages.
- Bypassing Cloudflare, CAPTCHAs, WAFs, robots policies, authentication, or rate limits.
- Any password, token, API key, or other credential in the browser.
- Ghost mutations.
- Default remote-media downloading.
- Server-side retention of user exports.
- Guaranteeing pure Markdown for semantics Markdown cannot represent; safe HTML is the defined fallback.

## Further notes

The architecture evidence and source links are in `docs/research/architecture.md`. Hosting is static Cloudflare Pages for v1, with a future server-side API proxy treated as a separate feature rather than smuggled into the client-only path.
