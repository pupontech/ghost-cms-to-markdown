import { describe, expect, it } from 'vitest';
import { convertMarkdown } from '../src/convert';

describe('convertMarkdown', () => {
  it('converts headings and inline formatting', () => {
    const out = convertMarkdown('<h1>Title</h1><p>Hello <strong>world</strong> and <em>you</em></p>');
    expect(out.markdown).toContain('# Title');
    expect(out.markdown).toContain('Hello **world** and _you_');
  });

  it('converts unordered and ordered lists in order', () => {
    const ul = convertMarkdown('<ul><li>one</li><li>two</li></ul>');
    expect(ul.markdown).toContain('- one');

    const ol = convertMarkdown('<ol><li>first</li><li>second</li></ol>');
    expect(ol.markdown).toMatch(/1[.)]\s*first/);
    expect(ol.markdown).toMatch(/2[.)]\s*second/);
    expect(ol.markdown.indexOf('first')).toBeLessThan(ol.markdown.indexOf('second'));
  });

  it('converts fenced code blocks', () => {
    const out = convertMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(out.markdown).toContain('const x = 1;');
    expect(out.markdown.trim().startsWith('```')).toBe(true);
    expect(out.markdown.trim().endsWith('```')).toBe(true);
  });

  it('converts images with alt text and links', () => {
    const img = convertMarkdown('<img src="https://x.test/i.png" alt="A cat">');
    expect(img.markdown).toContain('![A cat](https://x.test/i.png)');

    const link = convertMarkdown('<a href="https://x.test/p">read more</a>');
    expect(link.markdown).toContain('[read more](https://x.test/p)');
  });

  it('converts GFM tables', () => {
    const out = convertMarkdown(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><td>Ada</td><td>37</td></tr></tbody></table>',
    );
    expect(out.markdown).toContain('| Name | Age |');
    expect(out.markdown).toContain('| --- | --- |');
    expect(out.markdown).toContain('| Ada | 37 |');
  });

  it('converts blockquotes', () => {
    const out = convertMarkdown('<blockquote><p>quoted text</p></blockquote>');
    expect(out.markdown).toContain('> quoted text');
  });

  it('strips scripts before conversion', () => {
    const out = convertMarkdown('<p>hello</p><script>alert(1)</script>');
    expect(out.markdown).not.toContain('alert(1)');
    expect(out.markdown).toContain('hello');
  });

  it('strips inline event handlers before conversion', () => {
    const out = convertMarkdown('<p onclick="steal()">safe</p>');
    expect(out.markdown).not.toContain('steal()');
    expect(out.markdown).toContain('safe');
  });

  it('neutralizes javascript: URLs in links and images', () => {
    const link = convertMarkdown('<a href="javascript:evil()">click</a>');
    expect(link.markdown).not.toContain('javascript:');
    expect(link.markdown).toContain('click');

    const img = convertMarkdown('<img src="javascript:evil()" alt="x">');
    expect(img.markdown).not.toContain('javascript:');
  });

  it('returns empty markdown for content that sanitizes to nothing', () => {
    const out = convertMarkdown('<script>alert(1)</script>');
    expect(out.markdown.trim()).toBe('');
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.warnings[0]).toMatch(/no safe content/i);
  });

  it('preserves Unicode and RTL text', () => {
    const out = convertMarkdown('<p>צִיוּר עברי</p>');
    expect(out.markdown).toContain('צִיוּר עברי');
  });
});