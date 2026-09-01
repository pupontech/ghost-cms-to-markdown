import { describe, expect, it } from 'vitest';
import { parseGhostExport } from '../src/parser';

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    uuid: 'u1',
    title: 'Hello World',
    slug: 'hello-world',
    html: '<p>Hello <strong>world</strong></p>',
    plaintext: 'Hello world',
    type: 'post',
    status: 'published',
    visibility: 'public',
    feature_image: null,
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-01-02 11:00:00',
    published_at: '2026-01-02 11:00:00',
    custom_excerpt: null,
    canonical_url: null,
    ...overrides,
  };
}

function bundle(data: Record<string, unknown>) {
  return [{ meta: { exported_on: 1, version: '5.0.0' }, data }];
}

function ok(input: unknown) {
  const out = parseGhostExport(input);
  if (!out.ok) throw new Error(`expected import to succeed but got ${out.error.code}`);
  return out;
}

describe('parseGhostExport', () => {
  it('parses a valid export with one post', () => {
    const out = ok({ db: bundle({ posts: [post()] }) });
    expect(out.entries).toHaveLength(1);
    const e = out.entries[0];
    expect(e.id).toBe('p1');
    expect(e.title).toBe('Hello World');
    expect(e.slug).toBe('hello-world');
    expect(e.type).toBe('post');
    expect(e.status).toBe('published');
    expect(e.html).toBe('<p>Hello <strong>world</strong></p>');
    expect(e.publishedAt).toBe('2026-01-02');
  });

  it('joins author relations from posts_authors and users', () => {
    const users = [{ id: 'auth1', name: 'Ada Lovelace' }];
    const relations = [{ id: 'r1', post_id: 'p1', author_id: 'auth1' }];
    const out = ok({ db: bundle({ posts: [post()], users, posts_authors: relations }) });
    expect(out.entries[0].authors).toEqual(['Ada Lovelace']);
  });

  it('joins tag relations from posts_tags and tags', () => {
    const tags = [
      { id: 'tag1', name: 'Technology', slug: 'technology' },
      { id: 'tag2', name: 'JS', slug: 'js' },
    ];
    const relations = [
      { id: 'r1', post_id: 'p1', tag_id: 'tag1' },
      { id: 'r2', post_id: 'p1', tag_id: 'tag2' },
    ];
    const out = ok({ db: bundle({ posts: [post()], tags, posts_tags: relations }) });
    expect(out.entries[0].tags).toEqual(['Technology', 'JS']);
  });

  it('handles page entries', () => {
    const out = ok({ db: bundle({ posts: [post({ id: 'pg1', type: 'page' })] }) });
    expect(out.entries[0].type).toBe('page');
  });

  it('marks entries as coming from the JSON export', () => {
    const out = ok({ db: bundle({ posts: [post()] }) });
    expect(out.entries[0].source).toBe('json');
  });

  it('ignores unrelated collections', () => {
    const out = ok({
      db: bundle({
        posts: [post()],
        settings: [{ key: 'title', value: 'x' }],
        products: [{ id: 'prod' }],
      }),
    });
    expect(out.entries).toHaveLength(1);
  });

  it('surfaces unknown post types as skipped entries with a reason', () => {
    const out = ok({
      db: bundle({ posts: [post({ id: 'news', type: 'newsletter' })] }),
    });
    expect(out.entries).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].id).toBe('news');
    expect(out.skipped[0].type).toBe('newsletter');
    expect(out.skipped[0].reason).toMatch(/unsupported type/i);
  });

  it('surfaces malformed, blank-id, and duplicate entries without losing valid entries', () => {
    const out = ok({
      db: bundle({
        posts: [
          null,
          post({ id: '' }),
          post({ id: 'p1', title: 'First' }),
          post({ id: 'p1', title: 'Duplicate' }),
          post({ id: 'p2', title: 'Second' }),
        ] as unknown[],
      }),
    });

    expect(out.entries.map((entry) => entry.id)).toEqual(['p1', 'p2']);
    expect(out.skipped).toEqual([
      {
        id: '',
        title: '',
        type: 'unknown',
        reason: expect.stringMatching(/malformed/i),
      },
      {
        id: '',
        title: 'Hello World',
        type: 'post',
        reason: expect.stringMatching(/missing.*id/i),
      },
      {
        id: 'p1',
        title: 'Duplicate',
        type: 'post',
        reason: expect.stringMatching(/duplicate/i),
      },
    ]);
  });

  it('merges posts across multiple export bundles', () => {
    const data = { posts: [post({ id: 'a' })] };
    const data2 = { posts: [post({ id: 'b', title: 'Second' })] };
    const out = ok({ db: [data, data2].map((d) => ({ meta: {}, data: d })) });
    expect(out.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('coerces null instead of failing on missing optional fields', () => {
    const e = post();
    e.feature_image = null;
    e.published_at = null;
    delete (e as Record<string, unknown>).canonical_url;
    const out = ok({ db: bundle({ posts: [e] }) });
    expect(out.entries[0].canonicalUrl).toBeNull();
    expect(out.entries[0].publishedAt).toBeNull();
    expect(out.entries[0].featureImage).toBeNull();
  });

  it('reports a clear error for a non-object root', () => {
    const out = parseGhostExport('not an object');
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('invalid-root');
  });

  it('reports a clear error when the db collection is missing', () => {
    const out = parseGhostExport({});
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('missing-db');
  });

  it('reports a clear error when db is an empty array', () => {
    const out = parseGhostExport({ db: [] });
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('missing-bundle');
  });

  it('parses JSON text via the string entry point', () => {
    const text = JSON.stringify({ db: bundle({ posts: [post()] }) });
    const out = parseGhostExport(parseJsonSafe(text));
    if (!out.ok) throw new Error('expected success');
    expect(out.entries).toHaveLength(1);
  });
});

function parseJsonSafe(text: string): unknown {
  return JSON.parse(text);
}