# Ghost CMS to Markdown: architecture research

**Research date:** 2026-08-31

## Executive recommendation

Build the primary product as a static browser application:

1. The user exports content from Ghost Admin and drops the JSON file into the page.
2. The browser validates and parses the export locally.
3. The browser converts selected entries to Markdown, renders a sanitized preview, and creates `.md` or ZIP downloads.
4. No uploaded content or private export needs to reach our server.

Add a secondary Ghost Content API connector for public posts and pages. It should call the Content API from the browser with a Content API key, because Ghost documents that key as safe for browsers and limited to public data.[1] Do not accept Admin API keys in the static application. Ghost explicitly says Admin API keys are secret and unsuitable for browsers.[5][6]

Do not implement public URL import in the first release. A URL importer would either duplicate scraping or require a server-side fetcher with SSRF, bot-policy, and reliability problems. The product remains useful when the public site blocks bots because the primary path consumes the user's own Ghost export.

## Current v0.1 prototype boundary

The shipped v0.1 prototype implements the browser-local JSON export path, allowlisted HTML-to-Markdown conversion, optional YAML front matter, deterministic filenames, ZIP downloads, worker progress, and the paginated public Content API connector. Lexical, Mobiledoc, and card-specific fallback adapters remain research-backed follow-up work; the current app reports an explicit per-entry error when no usable HTML is available. The sections below describe the evidence and target roadmap rather than implying those follow-up adapters are already shipped.

## Approach comparison

| Approach | Reliability | Credentials | Bulk | Scraping risk | Recommended |
| --- | --- | --- | --- | --- | --- |
| Ghost JSON export | High for owned content; exact export varies by Ghost version | None | Yes, posts, pages, tags, settings and related records | None | **Primary** |
| Content API | High for published public posts and pages | Public Content API key, safe to use in a browser | Yes, with explicit pagination | None | **Secondary** |
| Admin API | High completeness, including native Lexical and privileged content when the user's role allows it | Secret Admin API key or staff token; server-only | Yes, with pagination | None | Optional server-side phase |
| Public-site scraping | Variable and theme-dependent | None or site-specific credentials | Fragile | High | **Do not build as a foundation** |

Ghost's current API documentation lists Posts, Pages, Tags, Authors, Tiers, and Settings as Content API resources.[1] Browse responses include `meta.pagination`; the documented default is 15 records and the maximum `limit` is 100, so an API client must follow every page rather than assuming the first response is complete.[3][4]

## Ghost data-access findings

### Ghost JSON export

Ghost's help documentation says the Admin **Settings -> Advanced -> Import/Export** area exports posts and settings in one JSON file, including settings, staff users, posts, pages, and tags.[7] The current Ghost source keeps a database-style allowlist for the default export. It includes `posts`, `posts_authors`, `posts_meta`, `posts_tags`, `tags`, `users`, `settings`, and additional publishing collections such as products, newsletters, offers, benefits, and snippets.[10]

The exported download is wrapped as a top-level `db` array. Each bundle contains `meta` with `exported_on` and Ghost `version`, plus a `data` object containing named collections. The current Ghost test fixture shows posts with fields including `id`, `uuid`, `title`, `slug`, `mobiledoc`, `lexical`, `html`, `plaintext`, `feature_image`, `type`, `status`, `visibility`, `created_at`, `updated_at`, `published_at`, `custom_excerpt`, and `canonical_url`.[15]

The parser must use a narrow allowlist. The export can contain staff records and other site data that the converter does not need. It must not expose, display, or copy unrelated collections. It must also treat IDs, relation rows, and missing collections as untrusted input.

The content JSON should be treated as the source of truth for the primary workflow. The export path requires no API key, is not affected by public-site bot protection, and naturally supports drafts and private/member-only entries that a public Content API cannot provide.

Media is a separate concern. Ghost's newer site-export service models `content` as `export.json` and `media` as a distinct asynchronous component.[12] The first product therefore keeps image, audio, video, and file URLs external by default. A later opt-in asset pack can fetch only validated media URLs with explicit limits.

### Content API

Ghost's Content API is read-only, uses a `key` query parameter, and is designed for public data.[1] Its posts endpoint returns HTML plus metadata such as title, slug, feature image, dates, custom excerpt, canonical URL, authors, and tags when requested with `include=authors,tags`.[2] The Content API documentation says posts and pages expose `html` and `plaintext` formats, not Lexical or Markdown.[3]

The connector must:

- normalize the user URL to an HTTPS origin and construct `/ghost/api/content/` itself;
- validate the key without logging or persisting it;
- request `include=authors,tags` and the minimum required fields;
- request `limit=100`, then follow `meta.pagination.next` or the documented page count;
- support posts and pages separately;
- surface CORS and private-site failures as a clear message;
- never attempt a fallback scrape.

A Content API connector cannot promise drafts, private posts, or the full Admin data model. The UI must say that the JSON upload is the route for complete owned-content export.

### Admin API

Ghost's Admin API documentation says Admin API keys generate short-lived JWTs, are secret, and are only suitable for secure server-side environments.[5] Admin post responses include related authors, tags, and roles. The documented default format is Lexical, while `formats=html,lexical` requests both fields.[6] Admin browse endpoints are also paginated and accept `include`, `fields`, `filter`, `limit`, `page`, and `order`.[5][6]

The product should not ask users for Admin API credentials in the browser. If a future server-side connector is added, it must use a short-lived conversion session, memory-only credentials where feasible, strict origin and SSRF validation, redacted structured logs, request and time limits, and immediate credential disposal. It should request `formats=html,lexical` and use the returned HTML as the normal conversion input while retaining Lexical for diagnostics or a dedicated fallback.

### URL import

A public URL is not an official Ghost export channel. It depends on the site's theme output, public visibility, CORS, CDN behavior, robots policy, and anti-bot controls. The product will not bypass Cloudflare, CAPTCHAs, WAFs, authentication, rate limits, or robots.txt. URL import is disabled until a non-scraping, official structured endpoint with predictable permissions can be demonstrated.

## Content and conversion strategy

### Canonical input order

Use this order for each source entry:

1. `html`, when present and non-empty.
2. A supported Markdown field or Markdown card payload, when present.
3. `lexical`, rendered by the application's supported Lexical adapter.
4. `mobiledoc`, rendered by the application's supported Mobiledoc adapter.
5. Otherwise, mark the entry as failed with a user-readable reason.

HTML is the best first canonical input because Ghost exposes it through the Content API, the Admin API can request it alongside Lexical, and Ghost's own Lexical and Mobiledoc server libraries render editor state to HTML.[2][3][6][13][14] The application must retain the source format and emit warnings when it falls back.

### Libraries

Use a Vite + TypeScript SPA with these focused browser dependencies:

- **Turndown** for HTML to Markdown conversion. It is an established JavaScript HTML-to-Markdown converter with browser usage documented by the project.[16][30]
- **turndown-plugin-gfm** for tables and strikethrough, with explicit tests for table output.[17][31]
- **DOMPurify** for sanitizing imported HTML before preview and before preserving unsupported HTML blocks.[18][33]
- **JSZip** for client-side ZIP generation and downloads.[19][32]
- **Vitest** for fast unit and browser-oriented module tests.[34]

The conversion layer must not pass arbitrary imported HTML directly into `innerHTML`. Sanitize first, convert from a detached sanitized DOM, and sanitize any preserved HTML fallback again. Preview rendering and Markdown text are separate paths.

### Ghost cards

Ghost's current card documentation lists image, Markdown, HTML, gallery, divider, bookmark, button, callout, toggle, audio, video, file, product, header, embeds, signup, and other interactive cards.[9] The card policy is:

| Card/content | Markdown output |
| --- | --- |
| Image | Standard image syntax with alt text; caption as a following paragraph or HTML figure when needed |
| Gallery | Ordered sequence of image syntax, retaining captions where available |
| Markdown | Preserve the card Markdown after safe normalization |
| Divider | `---` |
| Bookmark | Markdown link with title and optional description; retain URL |
| Button | Markdown link, with visible label and URL |
| Callout | Blockquote or sanitized HTML block when color/emoji semantics matter |
| Toggle | HTML `<details>` block to retain collapsed behavior and content |
| Code block | Fenced code with language identifier when available |
| HTML | Sanitized HTML block, never executed |
| Embed | Prefer the canonical URL as a Markdown link; use sanitized HTML only when the card has meaningful non-URL content |
| Audio, video, file | Markdown link with label and URL; preserve caption and MIME hints in HTML when Markdown cannot represent them |
| Product, signup, header, CTA, paywall, email, and unknown cards | Sanitized HTML fallback plus a visible conversion warning |

The converter must inspect Ghost card markers before Turndown runs. An unsupported card is never silently deleted. Each affected document carries a warning, and the bulk result reports warning and failure counts independently.

### Lexical and Mobiledoc compatibility

Modern Ghost stores editor content in a Lexical field, while older exports may contain Mobiledoc. Ghost's own source wires Lexical and Mobiledoc renderers and card libraries on the server.[13][14] The browser implementation should prefer an already available `html` field. The API connector requests HTML explicitly. For JSON entries that truly lack HTML, implement a constrained adapter for common text nodes, formatting, links, lists, quotes, code, images, horizontal rules, and known card payloads. Unknown Lexical nodes and Mobiledoc cards become sanitized HTML-style warning blocks rather than disappearing.

## Front matter and filenames

Use YAML front matter by default. The initial schema is:

```yaml
---
title: "Example Post"
slug: example-post
date: 2026-08-31
updated: 2026-08-31
author: "Author Name"
tags:
  - Technology
canonical_url: "https://example.com/example-post/"
---
```

The UI must allow front matter on or off and let users choose fields. Keep the internal metadata model richer than the default output so TOML and JSON serializers can be added without changing parsing. Omit null values by default. Quote YAML strings safely and preserve Unicode, Hebrew, Arabic, and emoji.

Generate filenames from `slug`, falling back to a normalized title and then a stable ID. Replace Windows-reserved characters and control characters, normalize whitespace, cap length, preserve Unicode letters, and resolve duplicates deterministically with `-2`, `-3`, and so on. Never use a user-provided path as a filesystem path.

## Data flow

```text
Ghost Admin export JSON
          |
          v
  File size/type gate
          |
          v
  Strict Ghost shape parser ---- invalid -> clear error, no partial state
          |
          v
  Normalized entries + relation maps
          |
          v
  Search/filter/select in browser
          |
          v
  Worker conversion queue
   |       |        |
   |       |        +--> per-entry warnings/errors
   |       +-----------> Markdown + metadata
   +-------------------> progress events
          |
          v
  Sanitized preview / result table
          |
          +--> single .md Blob download
          +--> JSZip worker -> ZIP Blob download
```

The optional Content API flow enters at `Normalized entries` after its paginated fetcher. There is no scraping branch.

## Large-export design

The UI must remain responsive for 1, 10, 100, 1,000, and practical 10,000-entry fixtures. Parse and convert in a Web Worker, transfer progress messages, and process entries independently. Use bounded batches and release intermediate HTML/DOM references after each item. A corrupt item becomes a per-entry error; it does not abort the batch. ZIP generation must use bounded concurrency and a clear maximum export size so a browser cannot be driven into unbounded memory use.

For v1, enforce a configurable JSON file limit with a conservative default suitable for browser memory, show the exact limit, and reject before parsing. Do not claim unlimited 10,000-entry support until fixtures and a real browser run demonstrate it.

## Privacy and security model

- Primary JSON conversion is client-only. Do not upload the file or send content to analytics, telemetry, AI, or third parties.
- Keep imported data in memory only; clear the active document set when the user resets or leaves the flow.
- Do not persist Ghost exports, API keys, converted content, or filenames in localStorage by default.
- Parse JSON with `JSON.parse` and a strict structural validator. Reject non-object roots, oversized arrays, excessive nesting, and unexpected content shapes.
- Use DOMPurify with an allowlist appropriate for Markdown conversion and a stricter preview policy. Remove scripts, event handlers, forms, iframes, executable URLs, and dangerous SVG content.
- Treat URLs in content as data. Only the optional asset-fetch phase may request them, and that phase is not part of the default workflow.
- The static app has no Admin API secret and no server upload endpoint. If a server connector is added later, enforce SSRF protections, allow only HTTPS, resolve and re-check DNS/IP ranges, disable redirects to private networks, cap response size, and never proxy arbitrary URLs.
- Add upload size limits, ZIP output limits, secure HTTP headers, a strict CSP, and accessible error messages.

## Hosting recommendation

Use Cloudflare Pages for the first production deployment. This product's primary workflow is static and browser-local, so it needs no server, database, or secret. Cloudflare documents free and paid Pages plans with free, unlimited static asset requests.[24] The Pages platform documents up to 20,000 files on the Free plan.[23] Cloudflare provides a Vite deployment path that builds the project and deploys the generated `dist` directory.[26]

Keep any future server-side API proxy separate from the static build. Cloudflare Workers document 100 MB request bodies on the Free plan, 128 MB memory, and 10 ms CPU time, so a Worker is acceptable for small, tightly bounded API requests but is not the place to buffer arbitrary multi-hundred-megabyte exports.[25] Because JSON conversion stays in the browser, the product avoids that server limit.

Vercel and Netlify remain valid alternatives, especially if the product later becomes a server-rendered or server-heavy application. Vercel's current function documentation lists a 4.5 MB request/response body limit for Functions.[27] Netlify documents a 6 MB buffered request/response limit and a 60-second synchronous execution limit.[28] Those constraints further support keeping the large-file primary workflow client-side.

## Implementation plan

1. Add the Vite TypeScript app and test harness without changing the provisional domain model.
2. Implement strict export parsing and normalized entry/relation models.
3. Implement one vertical slice: one JSON post with HTML, metadata, YAML front matter, safe filename, Markdown preview, and `.md` download.
4. Add cards, Lexical/Mobiledoc fallbacks, warnings, and malformed-entry isolation.
5. Add multi-select search/filtering, worker progress, and ZIP export.
6. Add the paginated Content API connector without Admin credentials.
7. Add security headers, limits, fixture coverage, browser dogfood, and Cloudflare Pages deployment configuration.
8. Run Matt-style standards and spec review against the assembled diff before release.

## Explicit non-goals for the first release

- Scraping public Ghost sites.
- Accepting Admin API keys in the browser.
- Downloading all remote media by default.
- Mutating Ghost content.
- Sending user content to third-party conversion or AI services.
- Claiming that every custom card can be represented as pure Markdown. Unsupported semantics must remain as sanitized HTML with a warning.

## Sources

[1] https://docs.ghost.org/content-api
[2] https://docs.ghost.org/content-api/posts
[3] https://docs.ghost.org/content-api/parameters
[4] https://docs.ghost.org/content-api/pagination
[5] https://docs.ghost.org/admin-api
[6] https://docs.ghost.org/admin-api/posts/overview
[7] https://ghost.org/help/exports
[9] https://ghost.org/help/cards
[10] https://raw.githubusercontent.com/TryGhost/Ghost/main/ghost/core/core/server/data/exporter/table-lists.js
[12] https://raw.githubusercontent.com/TryGhost/Ghost/main/ghost/core/core/server/services/exports/site-exporter.ts
[13] https://raw.githubusercontent.com/TryGhost/Ghost/main/ghost/core/core/server/lib/lexical.js
[14] https://raw.githubusercontent.com/TryGhost/Ghost/main/ghost/core/core/server/lib/mobiledoc.js
[15] https://raw.githubusercontent.com/TryGhost/Ghost/main/ghost/core/test/utils/fixtures/export/v5_export.json
[16] https://github.com/mixmark-io/turndown
[17] https://github.com/domchristie/turndown-plugin-gfm
[18] https://github.com/cure53/DOMPurify
[19] https://github.com/stuk/jszip
[23] https://developers.cloudflare.com/pages/platform/limits
[24] https://developers.cloudflare.com/pages/functions/pricing
[25] https://developers.cloudflare.com/workers/platform/limits
[26] https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project
[27] https://vercel.com/docs/functions/limitations
[28] https://docs.netlify.com/build/functions/configuration
[30] https://www.npmjs.com/package/turndown
[31] https://www.npmjs.com/package/turndown-plugin-gfm
[32] https://www.npmjs.com/package/jszip
[33] https://www.npmjs.com/package/dompurify
[34] https://www.npmjs.com/package/vitest
