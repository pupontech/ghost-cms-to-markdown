import { describe, expect, it, vi } from 'vitest';
import {
  fetchContentApiEntries,
  normalizeOrigin,
  validateContentApiKey,
} from '../src/content-api';

function post(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Post ${id}`,
    slug: `post-${id}`,
    html: `<p>Body ${id}</p>`,
    status: 'published',
    visibility: 'public',
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-02T11:00:00.000Z',
    published_at: '2026-01-02T11:00:00.000Z',
    feature_image: null,
    canonical_url: null,
    custom_excerpt: null,
    authors: [{ name: 'Ada Lovelace' }],
    tags: [{ name: 'Technology' }],
    ...overrides,
  };
}

/** Builds a fake fetch keyed by requested page number. */
function makeFetcher(
  respond: (page: number) => { status?: number; body?: unknown; raw?: string },
): { fetchImpl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const r = respond(page);
    if (r.status !== undefined && r.status !== 200) {
      return new Response('', { status: r.status });
    }
    if (r.raw !== undefined) {
      return new Response(r.raw, { status: 200 });
    }
    return new Response(JSON.stringify(r.body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, requested };
}

const KEY = '0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef';
const OPTS = { origin: 'https://example.com', key: KEY, type: 'post' as const };

describe('normalizeOrigin', () => {
  it('returns the canonical https origin and drops paths', () => {
    expect(normalizeOrigin('https://example.com')).toBe('https://example.com');
    expect(normalizeOrigin('https://example.com/blog/')).toBe('https://example.com');
    expect(normalizeOrigin('https://sub.example.com')).toBe('https://sub.example.com');
  });

  it('rejects http, malformed, and empty origins', () => {
    expect(normalizeOrigin('http://example.com')).toBeNull();
    expect(normalizeOrigin('example.com')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('https://')).toBeNull();
  });
});

describe('validateContentApiKey', () => {
  it('accepts a well-formed id:secret key', () => {
    expect(validateContentApiKey(KEY)).toBe(true);
  });

  it('rejects missing, short, whitespace-laden, and colon-less values', () => {
    expect(validateContentApiKey('')).toBe(false);
    expect(validateContentApiKey('short')).toBe(false);
    expect(validateContentApiKey('no-colon-here')).toBe(false);
    expect(validateContentApiKey(`${KEY} `)).toBe(false);
    expect(validateContentApiKey(' id:secret')).toBe(false);
    expect(validateContentApiKey('id:')).toBe(false);
    expect(validateContentApiKey(':secret')).toBe(false);
  });
});

describe('fetchContentApiEntries', () => {
  it('fetches public posts with include=authors,tags and normalizes them', async () => {
    const { fetchImpl, requested } = makeFetcher(() => ({
      body: {
        posts: [post('p1'), post('p2', { title: 'Second', canonical_url: 'https://example.com/second/' })],
        meta: { pagination: { page: 1, limit: 100, pages: 1, total: 2, next: null, prev: null } },
      },
    }));

    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');

    expect(out.entries).toHaveLength(2);
    const [first, second] = out.entries;
    expect(first.id).toBe('p1');
    expect(first.source).toBe('content-api');
    expect(first.type).toBe('post');
    expect(first.title).toBe('Post p1');
    expect(first.authors).toEqual(['Ada Lovelace']);
    expect(first.tags).toEqual(['Technology']);
    expect(first.publishedAt).toBe('2026-01-02');
    expect(second.canonicalUrl).toBe('https://example.com/second/');

    expect(requested).toHaveLength(1);
    const url = new URL(requested[0]);
    expect(url.pathname).toBe('/ghost/api/content/posts/');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(url.searchParams.get('include')).toBe('authors,tags');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('follows meta.pagination until every page is fetched', async () => {
    // 250 records at 100/page => 3 pages.
    const total = 250;
    const { fetchImpl, requested } = makeFetcher((page) => {
      const start = (page - 1) * 100;
      const count = Math.min(100, total - start);
      const items = Array.from({ length: count }, (_, i) =>
        post(`p${start + i + 1}`, { slug: `post-${start + i + 1}` }),
      );
      return {
        body: {
          posts: items,
          meta: { pagination: { page, limit: 100, pages: 3, total, next: page < 3 ? page + 1 : null, prev: null } },
        },
      };
    });

    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');
    expect(out.entries).toHaveLength(250);
    expect(requested).toHaveLength(3);
    expect(new URL(requested[0]).searchParams.get('page')).toBe('1');
    expect(new URL(requested[1]).searchParams.get('page')).toBe('2');
    expect(new URL(requested[2]).searchParams.get('page')).toBe('3');
    expect(out.entries[0].id).toBe('p1');
    expect(out.entries[249].id).toBe('p250');
  });

  it('follows a numeric `next` pagination field when present', async () => {
    let calls = 0;
    const { fetchImpl, requested } = makeFetcher(() => {
      calls += 1;
      return {
        body: {
          posts: calls === 1 ? [post('a'), post('b')] : [post('c')],
          meta: {
            pagination: {
              page: calls === 1 ? 1 : 2,
              limit: 100,
              pages: 2,
              total: 3,
              next: calls === 1 ? 2 : null,
              prev: calls === 1 ? null : 1,
            },
          },
        },
      };
    });

    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');
    expect(out.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(requested).toHaveLength(2);
  });

  it('queries the pages endpoint and marks entries as pages', async () => {
    const { fetchImpl, requested } = makeFetcher(() => ({
      body: {
        pages: [post('pg1', { title: 'About', slug: 'about' })],
        meta: { pagination: { page: 1, limit: 100, pages: 1, total: 1, next: null, prev: null } },
      },
    }));

    const out = await fetchContentApiEntries({ ...OPTS, type: 'page', fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');
    expect(out.entries[0].type).toBe('page');
    expect(new URL(requested[0]).pathname).toBe('/ghost/api/content/pages/');
  });

  it('de-duplicates ids if a site misreports pagination', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        JSON.stringify({
          posts: [post('dup'), post('dup')],
          meta: { pagination: { page: 1, limit: 100, pages: 1, total: 2, next: null, prev: null } },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');
    expect(out.entries).toHaveLength(1);
  });

  it('rejects invalid origins and keys without fetching', async () => {
    const fetchImpl = vi.fn();
    const badOrigin = await fetchContentApiEntries({ ...OPTS, origin: 'example.com', fetchImpl });
    expect(badOrigin.ok).toBe(false);
    if (badOrigin.ok) throw new Error('expected failure');
    expect(badOrigin.error.code).toBe('invalid-origin');

    const badKey = await fetchContentApiEntries({ ...OPTS, key: 'nope', fetchImpl });
    expect(badKey.ok).toBe(false);
    if (badKey.ok) throw new Error('expected failure');
    expect(badKey.error.code).toBe('invalid-key');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces HTTP failures as a clear error', async () => {
    const { fetchImpl } = makeFetcher(() => ({ status: 401 }));
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('http');
    expect(out.error.message).toMatch(/401/);
  });

  it('surfaces network/CORS failures as a clear error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('network');
    expect(out.error.message).toMatch(/CORS/);
  });

  it('surfaces malformed JSON bodies as a clear error', async () => {
    const { fetchImpl } = makeFetcher(() => ({ raw: '<html>not json</html>' }));
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('malformed');
  });

  it('stops with a pagination error instead of looping when pages claim more than they return', async () => {
    const { fetchImpl } = makeFetcher(() => ({
      body: {
        posts: [],
        meta: { pagination: { page: 1, limit: 100, pages: 5, total: 0, next: 2, prev: null } },
      },
    }));
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('pagination');
  });

  it('rejects a pagination cursor beyond the hard page ceiling', async () => {
    const { fetchImpl, requested } = makeFetcher(() => ({
      body: {
        posts: [post('p1')],
        meta: { pagination: { page: 1, limit: 100, pages: 5000, total: 1, next: 5000, prev: null } },
      },
    }));
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('pagination');
    expect(requested).toHaveLength(1);
  });

  it('warns but succeeds when a site returns no records', async () => {
    const { fetchImpl } = makeFetcher(() => ({
      body: { posts: [], meta: { pagination: { page: 1, limit: 100, pages: 1, total: 0, next: null, prev: null } } },
    }));
    const out = await fetchContentApiEntries({ ...OPTS, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected success');
    expect(out.entries).toHaveLength(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.warnings[0]).toMatch(/no public posts/i);
  });
});
