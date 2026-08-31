import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildExportZip } from '../src/zip';

function loadZip(blob: Blob) {
  return JSZip.loadAsync(blob);
}

describe('buildExportZip', () => {
  it('packs documents under ghost-markdown-export/posts/ and /pages/ with .md filenames', async () => {
    const blob = await buildExportZip([
      { entryId: 'p1', type: 'post', filename: 'hello-world.md', markdown: '# Hello' },
      { entryId: 'p2', type: 'page', filename: 'about.md', markdown: '# About' },
    ]);
    const zip = await loadZip(blob);
    const names = Object.keys(zip.files);
    expect(names).toContain('ghost-markdown-export/posts/hello-world.md');
    expect(names).toContain('ghost-markdown-export/pages/about.md');
    expect(
      await zip.file('ghost-markdown-export/posts/hello-world.md')!.async('string'),
    ).toBe('# Hello');
    expect(
      await zip.file('ghost-markdown-export/pages/about.md')!.async('string'),
    ).toBe('# About');
  });

  it('leaves external asset URLs unchanged by default', async () => {
    const markdown =
      'A post with an image:\n\n![alt](https://cdn.example.com/img/photo.png?v=1)\n\nAnd a link: [site](https://example.com/)';
    const blob = await buildExportZip([
      { entryId: 'p1', type: 'post', filename: 'images.md', markdown },
    ]);
    const zip = await loadZip(blob);
    const text = await zip.file('ghost-markdown-export/posts/images.md')!.async('string');
    expect(text).toContain('https://cdn.example.com/img/photo.png?v=1');
    expect(text).toContain('https://example.com/');
  });

  it('skips documents whose filenames are not path-safe', async () => {
    const blob = await buildExportZip([
      { entryId: 'a', type: 'post', filename: '../escape.md', markdown: 'x' },
      { entryId: 'b', type: 'post', filename: 'ok.md', markdown: 'y' },
      { entryId: 'c', type: 'post', filename: 'a/b.md', markdown: 'z' },
    ]);
    const zip = await loadZip(blob);
    const names = Object.keys(zip.files);
    expect(names).not.toContain('ghost-markdown-export/posts/../escape.md');
    expect(names).not.toContain('ghost-markdown-export/posts/a/b.md');
    expect(names).toContain('ghost-markdown-export/posts/ok.md');
  });

  it('produces a streaming-readable Blob', async () => {
    const blob = await buildExportZip([
      { entryId: 'a', type: 'post', filename: 'a.md', markdown: 'a' },
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});