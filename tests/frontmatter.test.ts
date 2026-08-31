import { describe, expect, it } from 'vitest';
import { serializeFrontMatter } from '../src/frontmatter';
import type { FrontMatterMetadata } from '../src/frontmatter';

describe('serializeFrontMatter', () => {
  it('renders a delimiter-delimited block with core fields', () => {
    const out = serializeFrontMatter({
      title: 'Example Post',
      slug: 'example-post',
      date: '2026-08-31',
    });
    expect(out).toBe(
      '---\n' +
        'title: "Example Post"\n' +
        'slug: example-post\n' +
        'date: 2026-08-31\n' +
        '---\n',
    );
  });

  it('omits null and undefined fields', () => {
    const out = serializeFrontMatter({
      title: 'T',
      author: null,
      tags: undefined,
      canonicalUrl: null,
    });
    expect(out).toBe('---\ntitle: "T"\n---\n');
  });

  it('renders tags as an indented list of quoted items', () => {
    const out = serializeFrontMatter({
      title: 'Tech',
      tags: ['Technology', 'JS 2026'],
    });
    expect(out).toContain('tags:\n  - "Technology"\n  - "JS 2026"');
  });

  it('renders a single author as a scalar and multiple authors as a list', () => {
    const single = serializeFrontMatter({ title: 'T', author: 'Ada Lovelace' });
    expect(single).toContain('author: "Ada Lovelace"');

    const multi = serializeFrontMatter({ title: 'T', author: ['Ada', 'Grace'] });
    expect(multi).toContain('author:\n  - "Ada"\n  - "Grace"');
  });

  it('quotes strings that could break YAML and preserves Unicode and emoji', () => {
    const out = serializeFrontMatter({
      title: 'צִיוּר: "emoji" 🎨',
      slug: 'hebrew-art',
    });
    expect(out).toContain('title: "צִיוּר: \\"emoji\\" 🎨"');
    expect(out).toContain('slug: hebrew-art');
  });

  it('escapes line breaks and tabs inside quoted YAML scalars', () => {
    const out = serializeFrontMatter({ title: 'first\nsecond', author: 'Ada\tLovelace' });
    expect(out).toContain('title: "first\\nsecond"');
    expect(out).toContain('author: "Ada\\tLovelace"');
  });

  it('honours field selection and keeps the fixed ordering', () => {
    const meta: FrontMatterMetadata = {
      title: 'Selected',
      slug: 'selected',
      date: '2024-01-01',
      updated: '2024-02-01',
      canonicalUrl: 'https://x.test/y',
    };
    const out = serializeFrontMatter(meta, ['canonicalUrl', 'title']);
    expect(out).toBe(
      '---\n' +
        'title: "Selected"\n' +
        'canonical_url: "https://x.test/y"\n' +
        '---\n',
    );
  });

  it('returns an empty string when nothing is selected and present', () => {
    expect(serializeFrontMatter({})).toBe('');
  });
});