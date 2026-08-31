import type { NormalizedEntry } from './parser';

/**
 * Public Ghost Content API connector.
 *
 * This is the *secondary* import path: it reads public posts or pages using a
 * public Content API key, which Ghost documents as safe to expose in a browser
 * and limited to public data. It never accepts Admin API keys, never logs or
 * persists the key, and never attempts a scraping fallback. Every request is a
 * plain GET to the site's own `/ghost/api/content/` endpoint, and pagination is
 * followed until every page is fetched.
 */

export type ContentApiErrorCode =
  | 'invalid-origin'
  | 'invalid-key'
  | 'network'
  | 'http'
  | 'malformed'
  | 'pagination';

export interface ContentApiError {
  code: ContentApiErrorCode;
  message: string;
}

export interface ContentApiOptions {
  /** Base origin, e.g. `https://example.com`. Trailing path is ignored. */
  origin: string;
  /** Public Content API key (an `id:secret` pair). Never sent anywhere but Ghost. */
  key: string;
  /** Which public resource to fetch. */
  type: 'post' | 'page';
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export type ContentApiOutcome =
  | { ok: true; entries: NormalizedEntry[]; warnings: string[] }
  | { ok: false; error: ContentApiError };

/** Records per page. The Content API default is 15; the max is 100. */
const PAGE_LIMIT = 100;

/** Safety valve so a broken site can never drive an unbounded loop. */
const MAX_PAGES = 2000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Ghost Content API dates arrive as full ISO strings; keep the YYYY-MM-DD part. */
function toDate(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? match[1] : null;
}

/** Content API includes authors/tags as nested objects with a `name` field. */
function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const name = isObject(item) ? str(item.name) : null;
    if (name !== null && name !== '') out.push(name);
  }
  return out;
}

/**
 * Normalizes a user-entered site address to a canonical HTTPS origin, or null
 * when the value is not an absolute `https://` URL. The origin is what we are
 * allowed to talk to; any path or trailing slash is dropped so we always build
 * `/ghost/api/content/` ourselves.
 */
export function normalizeOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  return url.origin;
}

/**
 * Validates a public Content API key shape without leaking it. Ghost keys are
 * `{id}:{secret}`. We refuse empty, whitespace-laden, or control-character
 * values and require the colon, but we never echo the key back to the user or
 * store it.
 */
export function validateContentApiKey(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  if (raw.length < 8) return false;
  if (/[\u0000-\u0020\u007f]/.test(raw)) return false;
  const sep = raw.indexOf(':');
  if (sep <= 0 || sep === raw.length - 1) return false;
  const id = raw.slice(0, sep);
  const secret = raw.slice(sep + 1);
  return id.length > 0 && secret.length > 0;
}

function toEntry(raw: unknown, type: 'post' | 'page'): NormalizedEntry | null {
  if (!isObject(raw)) return null;
  const warnings: string[] = [];
  if (str(raw.title) === null) warnings.push('Entry is missing a title.');
  return {
    id: str(raw.id) ?? '',
    title: str(raw.title) ?? '',
    slug: str(raw.slug) ?? '',
    type,
    status: str(raw.status) ?? 'published',
    visibility: str(raw.visibility) ?? 'public',
    createdAt: toDate(raw.created_at),
    updatedAt: toDate(raw.updated_at),
    publishedAt: toDate(raw.published_at),
    featureImage: str(raw.feature_image),
    canonicalUrl: str(raw.canonical_url),
    customExcerpt: str(raw.custom_excerpt),
    authors: names(raw.authors),
    tags: names(raw.tags),
    html: str(raw.html),
    source: 'content-api',
    warnings,
  };
}

function buildUrl(origin: string, type: 'post' | 'page', key: string, page: number): string {
  const resource = type === 'post' ? 'posts' : 'pages';
  const params = new URLSearchParams({
    key,
    include: 'authors,tags',
    limit: String(PAGE_LIMIT),
    page: String(page),
  });
  return `${origin}/ghost/api/content/${resource}/?${params.toString()}`;
}

interface PageData {
  items: Array<Record<string, unknown>>;
  nextPage: number | null;
}

/**
 * Fetches one page and returns its normalized source records plus the next page
 * number to request (or null when the traversal is complete).
 */
async function fetchPage(
  fetchImpl: typeof fetch,
  url: string,
  resourceKey: string,
): Promise<{ data: PageData } | { error: ContentApiError }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch {
    return {
      error: {
        code: 'network',
        message:
          'Could not reach this Ghost site from the browser. Content API calls need the site to allow cross-origin (CORS) requests; check the site or use a JSON export instead.',
      },
    };
  }

  if (!response.ok) {
    return {
      error: {
        code: 'http',
        message: `The Content API returned HTTP ${response.status}. The site may be private or the key invalid. Check the key and that the site is public.`,
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      error: {
        code: 'malformed',
        message: 'The Content API returned a response that is not valid JSON.',
      },
    };
  }

  if (!isObject(body)) {
    return {
      error: { code: 'malformed', message: 'The Content API returned an unexpected payload.' },
    };
  }

  const meta = isObject(body.meta) ? body.meta : null;
  const pagination = meta && isObject(meta.pagination) ? meta.pagination : null;

  const items: Array<Record<string, unknown>> = Array.isArray(body[resourceKey])
    ? (body[resourceKey] as Array<Record<string, unknown>>)
    : [];

  let nextPage: number | null = null;
  if (pagination) {
    const page = typeof pagination.page === 'number' ? pagination.page : 1;
    const pages = typeof pagination.pages === 'number' ? pagination.pages : page;
    const numericNext = typeof pagination.next === 'number' ? pagination.next : null;
    if (numericNext !== null && numericNext > page) {
      if (numericNext > MAX_PAGES) {
        return {
          error: {
            code: 'pagination',
            message: `The Content API reported more than ${MAX_PAGES} pages; stopping to avoid an unbounded import.`,
          },
        };
      }
      nextPage = numericNext;
    } else if (page < pages && page < MAX_PAGES) {
      nextPage = page + 1;
    } else if (page < pages) {
      return {
        error: {
          code: 'pagination',
          message: `The Content API reported more than ${MAX_PAGES} pages; stopping to avoid an unbounded import.`,
        },
      };
    }
  }

  return { data: { items, nextPage } };
}

/**
 * Fetches all public posts or pages for a Ghost site through its public Content
 * API key, following `meta.pagination` until complete. Returns normalized
 * entries on the same model as the JSON import path with `source:
 * 'content-api'`. On any failure it returns a single actionable error and never
 * falls back to scraping.
 */
export async function fetchContentApiEntries(
  options: ContentApiOptions,
): Promise<ContentApiOutcome> {
  const origin = normalizeOrigin(options.origin);
  if (origin === null) {
    return {
      ok: false,
      error: {
        code: 'invalid-origin',
        message: 'Enter a full HTTPS site address, such as https://example.com.',
      },
    };
  }

  if (!validateContentApiKey(options.key)) {
    return {
      ok: false,
      error: {
        code: 'invalid-key',
        message: 'Enter the public Content API key (id:secret) from Ghost Admin -> Integrations.',
      },
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const type = options.type === 'page' ? 'page' : 'post';

  const entries: NormalizedEntry[] = [];
  const warnings: string[] = [];
  let page = 1;
  const seen = new Set<string>();

  while (true) {
    const resourceKey = type === 'post' ? 'posts' : 'pages';
    const outcome = await fetchPage(fetchImpl, buildUrl(origin, type, options.key, page), resourceKey);
    if ('error' in outcome) return { ok: false, error: outcome.error };

    for (const raw of outcome.data.items) {
      const entry = toEntry(raw, type);
      if (entry === null || entry.id === '') continue;
      // De-duplicate defences in case a site misreports pagination.
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }

    if (outcome.data.nextPage === null) break;
    if (entries.length === 0 && outcome.data.nextPage !== null) {
      return {
        ok: false,
        error: {
          code: 'pagination',
          message: 'The Content API reported more pages but returned no entries; stopping to avoid a loop.',
        },
      };
    }
    page = outcome.data.nextPage;
  }

  if (entries.length === 0) {
    warnings.push(`No public ${type === 'post' ? 'posts' : 'pages'} were found for this site.`);
  }

  return { ok: true, entries, warnings };
}