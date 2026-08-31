import { describe, expect, it } from 'vitest';
import { parseGhostExport } from '../src/parser';
import { buildDocument, buildDocuments } from '../src/pipeline';
import type { NormalizedEntry } from '../src/parser';

function exportWithPosts(posts: Array<Record<string, unknown>>) {
  return { db: [{ meta: {}, data: { posts } }] };
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: 'Hello World',
    slug: 'hello-world',
    html: '<p>Welcome to <strong>my blog</strong>.</p>',
    type: 'post',
    status: 'published',
    visibility: 'public',
    published_at: '2026-08-31 10:00:00',
    updated_at: '2026-09-01 09:00:00',
    tags: [],
    authors: [],
    ...overrides,
  };
}

function firstEntry(posts: Array<Record<string, unknown>>): NormalizedEntry {
  const out = parseGhostExport(exportWithPosts(posts));
  if (!out.ok) throw new Error('fixture should parse');
  return out.entries[0];
}

describe('buildDocuments (set-level)', () => {
  it('allocates filenames once across the whole set so duplicate slugs stay unique', () => {
    const out = parseGhostExport(
      exportWithPosts([makePost(), makePost({ id: 'p2' })]),
    );
    if (!out.ok) throw new Error('fixture should parse');
    const docs = buildDocuments(out.entries);
    expect(
      docs.map((d) => (d.ok ? d.filename : d.error.message)),
    ).toEqual(['hello-world.md', 'hello-world-2.md']);
  });

  it('reports a failed entry when sanitizing leaves no safe markdown', () => {
    const entry = firstEntry([makePost({ html: '<script>alert(1)</script>' })]);
    const docs = buildDocuments([entry]);
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    if (doc.ok) throw new Error('expected failure');
    expect(doc.error.code).toBe('empty-content');
    expect(doc.error.message).toMatch(/no safe content/i);
  });

  it('returns one outcome per input entry, in order', () => {
    const out = parseGhostExport(
      exportWithPosts([
        makePost(),
        makePost({ id: 'p2', html: '<script>x()</script>' }),
        makePost({ id: 'p3', slug: 'hello-world' }),
      ]),
    );
    if (!out.ok) throw new Error('fixture should parse');
    const docs = buildDocuments(out.entries);
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.ok)).toEqual([true, false, true]);
    expect(
      docs.filter((d) => d.ok).map((d) => (d.ok ? d.filename : '')),
    ).toEqual(['hello-world.md', 'hello-world-2.md']);
  });
});
describe('buildDocument (vertical slice)', () => {
  it('builds a deterministically named .md file with front matter and converted body', () => {
    const entry = firstEntry([makePost()]);
    const doc = buildDocument(entry);

    if (!doc.ok) throw new Error('expected success');

    expect(doc.filename).toBe('hello-world.md');
    expect(doc.markdown).toContain('---\ntitle: "Hello World"\nslug: hello-world\ndate: 2026-08-31');
    expect(doc.markdown).toContain('Welcome to **my blog**.');
  });

  it('sanitizes malicious HTML before it reaches the markdown body', () => {
    const entry = firstEntry([
      makePost({ html: '<p>ok</p><script>evil()</script><a href="javascript:x()">x</a>' }),
    ]);
    const doc = buildDocument(entry);
    if (!doc.ok) throw new Error('expected success');
    expect(doc.markdown).toContain('ok');
    expect(doc.markdown).not.toContain('evil()');
    expect(doc.markdown).not.toContain('javascript:');
  });

  it('reports a clear per-entry error when an entry has no content', () => {
    const entry = { ...firstEntry([makePost()]), html: null };
    const doc = buildDocument(entry);
    if (doc.ok) throw new Error('expected failure');
    expect(doc.error.code).toBe('no-content');
    expect(doc.error.message).toMatch(/no html content/i);
  });

  it('omits front matter when disabled', () => {
    const entry = firstEntry([makePost()]);
    const doc = buildDocument(entry, { frontMatter: false });
    if (!doc.ok) throw new Error('expected success');
    expect(doc.markdown).not.toContain('---\ntitle:');
    expect(doc.markdown).toContain('Welcome to **my blog**.');
  });

  it('assigns a page under its own slug-derived filename', () => {
    const entry = firstEntry([
      makePost({ id: 'pg1', type: 'page', slug: 'about', title: 'About' }),
    ]);
    const doc = buildDocument(entry);
    if (!doc.ok) throw new Error('expected success');
    expect(doc.filename).toBe('about.md');
    expect(doc.markdown).toContain('title: "About"');
  });
});