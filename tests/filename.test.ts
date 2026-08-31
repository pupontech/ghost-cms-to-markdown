import { describe, expect, it } from 'vitest';
import { allocateFilenames } from '../src/filename';
import type { FilenameSource } from '../src/filename';

describe('allocateFilenames', () => {
  it('builds a filename from the slug', () => {
    const out = allocateFilenames([{ id: 'a', slug: 'hello-world' }]);
    expect(out.get('a')).toBe('hello-world.md');
  });

  it('falls back to the title when the slug is empty', () => {
    const out = allocateFilenames([{ id: 'a', slug: '', title: 'My First Post' }]);
    expect(out.get('a')).toBe('my-first-post.md');
  });

  it('falls back to the stable id when slug and title are empty', () => {
    const out = allocateFilenames([{ id: 'abc-123', slug: '', title: '' }]);
    expect(out.get('abc-123')).toBe('abc-123.md');
  });

  it('sanitizes the fallback when every source field is malformed', () => {
    const out = allocateFilenames([{ id: ':::', slug: '', title: '' }]);
    expect(out.get(':::')).toBe('entry.md');
  });

  it('removes Windows-incompatible characters', () => {
    const out = allocateFilenames([{ id: 'a', slug: 'what:<is>this|file?' }]);
    expect(out.get('a')).toBe('what-is-this-file.md');
  });

  it('normalizes whitespace and strips trailing dots and spaces', () => {
    const out = allocateFilenames([{ id: 'a', slug: '  a   link   ' }]);
    expect(out.get('a')).toBe('a-link.md');
  });

  it('rejects leading and trailing dots from the stem', () => {
    const out = allocateFilenames([{ id: 'a', slug: '..hidden' }]);
    expect(out.get('a')).toBe('hidden.md');
  });

  it('preserves Unicode letters and RTL text', () => {
    const out = allocateFilenames([{ id: 'a', slug: 'גרסה חדשה' }]);
    expect(out.get('a')).toBe('גרסה-חדשה.md');
  });

  it('does not produce a reserved Windows device name', () => {
    const out = allocateFilenames([{ id: 'a', slug: 'CON', title: 'settings' }]);
    expect(out.get('a')).toBe('settings.md');
  });

  it('caps an overlong slug while keeping the extension', () => {
    const id = 'a';
    const slug = 'x'.repeat(300);
    const out = allocateFilenames([{ id, slug }]);
    const name = out.get('a');
    expect(name).toBeTruthy();
    expect(name!.endsWith('.md')).toBe(true);
    expect(name!.length).toBeLessThanOrEqual(104);
  });

  it('appends a deterministic counter for case-insensitive duplicate bases', () => {
    const out = allocateFilenames([
      { id: 'a', slug: 'My Post' },
      { id: 'b', slug: 'my post' },
      { id: 'c', slug: 'my-post' },
    ]);
    expect(out.get('a')).toBe('my-post.md');
    expect(out.get('b')).toBe('my-post-2.md');
    expect(out.get('c')).toBe('my-post-3.md');
  });

  it('keeps output keys aligned to the input order', () => {
    const src: FilenameSource[] = [
      { id: 'b', slug: 'beta' },
      { id: 'a', slug: 'alpha' },
    ];
    const out = allocateFilenames(src);
    expect([...out.keys()]).toEqual(['b', 'a']);
  });

  it('never hands out a name that equals one already allocated by suffixing an earlier base', () => {
    // foo, foo, foo-2: naive counting assigns foo and foo-2, then clobbers foo-2.
    const out = allocateFilenames([
      { id: 'a', slug: 'foo' },
      { id: 'b', slug: 'foo' },
      { id: 'c', slug: 'foo-2' },
    ]);
    expect(out.get('a')).toBe('foo.md');
    expect(out.get('b')).toBe('foo-2.md');
    expect(out.get('c')).toBe('foo-2-2.md');
    expect(new Set(out.values()).size).toBe(3);
  });

  it('keeps every assigned filename distinct when a suffix-shaped base collides', () => {
    const out = allocateFilenames([
      { id: 'x', slug: 'post' },
      { id: 'y', slug: 'post' },
      { id: 'z', slug: 'post-2' },
      { id: 'w', slug: 'post' },
    ]);
    const names = [...out.values()];
    expect(new Set(names).size).toBe(names.length);
    // The pre-supplied 'post-2' base must not be re-used for a duplicate.
    expect(out.get('z')).toBe('post-2-2.md');
    expect(out.get('w')).toBe('post-3.md');
  });
});