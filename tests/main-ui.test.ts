import { describe, expect, it } from 'vitest';
import { createApp } from '../src/main';

/**
 * Browser-flow smoke tests: drive the real SPA event handlers in jsdom,
 * covering Upload -> Select -> Convert -> Preview -> Download and the
 * secondary Content API form, plus front matter output options.
 */

function exportJson(): string {
  return JSON.stringify({
    db: [
      {
        meta: { exported_on: 1, version: '5.0.0' },
        data: {
          posts: [
            {
              id: 'p1', title: 'Hello World', slug: 'hello-world', type: 'post',
              status: 'published', visibility: 'public',
              html: '<p>Welcome to <strong>my blog</strong>.</p>',
              created_at: '2026-08-31 10:00:00', updated_at: '2026-09-01 09:00:00',
              published_at: '2026-08-31 10:00:00', feature_image: null,
              canonical_url: null, custom_excerpt: null,
            },
            {
              id: 'p2', title: 'Second Post', slug: 'second-post', type: 'post',
              status: 'draft', visibility: 'public',
              html: '<h1>Second</h1><p>Draft body</p>',
              created_at: '2026-08-30 10:00:00', updated_at: '2026-08-30 10:00:00',
              published_at: null, feature_image: null, canonical_url: null,
              custom_excerpt: null,
            },
            {
              id: 'pg1', title: 'About', slug: 'about', type: 'page',
              status: 'published', visibility: 'public',
              html: '<p>About us</p>',
              created_at: '2026-01-01 10:00:00', updated_at: '2026-01-01 10:00:00',
              published_at: '2026-01-01 10:00:00', feature_image: null,
              canonical_url: null, custom_excerpt: null,
            },
          ],
        },
      },
    ],
  });
}

function mount(): ReturnType<typeof createApp> {
  const container = document.createElement('div');
  document.body.append(container);
  return createApp(container);
}

describe('browser flow (jsdom smoke)', () => {
  it('upload -> select all -> convert -> preview -> results', async () => {
    const app = mount();
    const frontMatterToggle = document.querySelector<HTMLInputElement>('#fm-enabled');
    expect(frontMatterToggle).not.toBeNull();
    expect(frontMatterToggle?.checked).toBe(true);
    expect(document.querySelector('label[for="fm-enabled"]')).not.toBeNull();
    await app.loadExportText(exportJson());

    expect(app.visibleRows()).toHaveLength(3);
    expect(app.selectedIds()).toEqual([]);

    app.applySelection('all');
    expect(app.selectedIds().sort()).toEqual(['p1', 'p2', 'pg1']);

    const outcomes = await app.convert();
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((o) => o.ok)).toBe(true);

    expect(app.resultFilenames()).toEqual(['hello-world.md', 'second-post.md', 'about.md']);
    expect(app.note()).toContain('3 converted, 0 failed.');

    const preview = app.previewFirst();
    expect(preview).toContain('---\ntitle: "Hello World"');
    expect(preview).toContain('Welcome to **my blog**.');
  });

  it('keeps a per-entry failure isolated in the results', async () => {
    const app = mount();
    const json = JSON.parse(exportJson()) as { db: Array<{ data: { posts: Array<Record<string, unknown>> } }> };
    json.db[0].data.posts.push({
      id: 'bad', title: 'Bad', slug: 'bad', type: 'post', status: 'draft',
      html: '<script>evil()</script>', published_at: null,
    });
    await app.loadExportText(JSON.stringify(json));

    app.applySelection('all');
    const outcomes = await app.convert();
    const bad = outcomes.find((o) => o.entryId === 'bad');
    expect(bad?.ok).toBe(false);
    if (bad && bad.ok) throw new Error('expected failure');
    expect(app.note()).toContain('3 converted, 1 failed.');
  });

  it('search filters the visible selection surface', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.search('second');
    expect(app.visibleRows()).toHaveLength(1);
    expect(app.visibleRows()[0].id).toBe('p2');

    app.applySelection('all');
    expect(app.selectedIds()).toEqual(['p2']);
  });

  it('front matter can be turned off from the UI', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.frontMatter.setEnabled(false);
    expect(app.frontMatter.enabled()).toBe(false);

    app.applySelection('all');
    await app.convert();
    const preview = app.previewFirst();
    expect(preview).not.toContain('---\ntitle:');
    expect(preview).toContain('Welcome to **my blog**.');
  });

  it('front matter field selection limits emitted keys', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.frontMatter.setField('slug', false);
    app.frontMatter.setField('date', false);

    app.applySelection('all');
    await app.convert();
    const preview = app.previewFirst();
    expect(preview).toContain('title: "Hello World"');
    expect(preview).not.toContain('slug: hello-world');
    expect(preview).not.toContain('date:');
  });

  it('loading a new export clears the previous run’s results', async () => {
    const app = mount();
    await app.loadExportText(exportJson());
    app.applySelection('all');
    await app.convert();
    expect(app.resultFilenames()).toHaveLength(3);

    const fresh = JSON.stringify({
      db: [{ meta: {}, data: { posts: [{ id: 'x', title: 'Fresh', slug: 'fresh', type: 'post', status: 'published', html: '<p>new</p>' }] } }],
    });
    await app.loadExportText(fresh);

    expect(app.selectedIds()).toEqual([]);
    expect(app.resultFilenames()).toEqual([]);
    expect(app.note()).toContain('1 posts or pages parsed.');
    expect(app.visibleRows()).toHaveLength(1);
  });

  it('rejects invalid JSON and oversized files with clear messages', async () => {
    const app = mount();
    await app.loadExportText('not json');
    expect(app.visibleRows()).toHaveLength(0);

    // 51 MB fake file: the size gate fires before parsing.
    const big = JSON.stringify({ db: [{ meta: {}, data: { posts: [] } }] });
    await app.loadExportTextWithSize(big, 51 * 1024 * 1024);
    expect(app.visibleRows()).toHaveLength(0);
  });

  it('fetches public entries through the Content API form and converts them', async () => {
    const app = mount();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/ghost/api/content/posts/');
      expect(parsed.searchParams.get('include')).toBe('authors,tags');
      expect(parsed.searchParams.get('limit')).toBe('100');
      return new Response(
        JSON.stringify({
          posts: [
            {
              id: 'api1', title: 'API Post', slug: 'api-post', html: '<p>From the API</p>',
              status: 'published', visibility: 'public',
              created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
              published_at: '2026-05-01T00:00:00.000Z',
              authors: [{ name: 'Ada' }], tags: [{ name: 'Tech' }],
            },
          ],
          meta: { pagination: { page: 1, limit: 100, pages: 1, total: 1, next: null, prev: null } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const ok = await app.fetchApi({
      origin: 'https://example.com',
      key: '0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef',
      type: 'post',
      fetchImpl,
    });
    expect(ok).toBe(true);

    expect(app.visibleRows()).toHaveLength(1);
    expect(app.note()).toContain('1 public posts fetched.');

    app.applySelection('all');
    await app.convert();
    expect(app.resultFilenames()).toEqual(['api-post.md']);
    expect(app.previewFirst()).toContain('From the API');
  });

  it('surfaces a Content API failure without touching the selection', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const ok = await app.fetchApi({
      origin: 'https://example.com',
      key: '0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef',
      type: 'post',
      fetchImpl,
    });
    expect(ok).toBe(false);

    // The prior JSON export stays untouched.
    expect(app.visibleRows()).toHaveLength(3);
    expect(app.selectedIds()).toEqual([]);
  });
});
