import { describe, expect, it } from 'vitest';
import { convertMarkdown } from '../src/convert';

describe('convertMarkdown', () => {
  it('converts headings and inline formatting', () => {
    const out = convertMarkdown('<h1>Title</h1><p>Hello <strong>world</strong> and <em>you</em></p>');
    expect(out.markdown).toContain('# Title');
    expect(out.markdown).toContain('Hello **world** and _you_');
  });

  it('preserves heading hierarchy and escapes literal Markdown punctuation', () => {
    const out = convertMarkdown(
      '<h1>Guide</h1><div><h3>Details</h3></div>' +
      '<p>literal *stars* _marks_ [brackets] and `ticks`</p>',
    );
    expect(out.markdown).toContain('# Guide');
    expect(out.markdown).toContain('### Details');
    expect(out.markdown).toContain('\\*stars\\*');
    expect(out.markdown).toContain('\\_marks\\_');
    expect(out.markdown).toContain('\\[brackets]');
    expect(out.markdown).toContain('\\`ticks\\`');
  });

  it('preserves inline semantics that Markdown cannot represent natively', () => {
    const out = convertMarkdown(
      '<p><u>underlined</u> <mark>highlighted</mark> <sub>2</sub><sup>nd</sup></p>',
    );
    expect(out.markdown).toContain('<u>underlined</u>');
    expect(out.markdown).toContain('<mark>highlighted</mark>');
    expect(out.markdown).toContain('<sub>2</sub><sup>nd</sup>');
  });

  it('preserves disclosure content when Markdown has no equivalent structure', () => {
    const out = convertMarkdown(
      '<details open><summary>More</summary><p>Hidden content</p></details>',
    );
    expect(out.markdown).toContain('<details open>');
    expect(out.markdown).toContain('<summary>More</summary>');
    expect(out.markdown).toContain('<p>Hidden content</p>');
  });

  it('does not re-emit active embeds from raw HTML containers', () => {
    const out = convertMarkdown(
      '<details><summary>More</summary><iframe src="https://x.test/embed"></iframe></details>',
    );
    expect(out.markdown).not.toContain('<iframe');
    expect(out.markdown).toContain('[Embedded content](https://x.test/embed)');
  });

  it('does not re-emit form controls from raw HTML containers', () => {
    const out = convertMarkdown(
      '<details><summary>More</summary><u><input type="checkbox" checked disabled>done</u></details>',
    );
    expect(out.markdown).not.toContain('<input');
  });

  it('converts unordered and ordered lists in order', () => {
    const ul = convertMarkdown('<ul><li>one</li><li>two</li></ul>');
    expect(ul.markdown).toContain('- one');

    const ol = convertMarkdown('<ol><li>first</li><li>second</li></ol>');
    expect(ol.markdown).toMatch(/1[.)]\s*first/);
    expect(ol.markdown).toMatch(/2[.)]\s*second/);
    expect(ol.markdown.indexOf('first')).toBeLessThan(ol.markdown.indexOf('second'));
  });

  it('preserves task-list checkboxes and ordered-list starting numbers', () => {
    const out = convertMarkdown(
      '<ul><li><input type="checkbox" checked disabled>done</li>' +
      '<li><input type="checkbox" disabled>todo</li></ul>' +
      '<ol start="3"><li>third</li><li>fourth</li></ol>',
    );
    expect(out.markdown).toContain('- [x] done');
    expect(out.markdown).toContain('- [ ] todo');
    expect(out.markdown).toContain('3. third');
    expect(out.markdown).toContain('4. fourth');
  });

  it('converts fenced code blocks', () => {
    const out = convertMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(out.markdown).toContain('const x = 1;');
    expect(out.markdown.trim().startsWith('```')).toBe(true);
    expect(out.markdown.trim().endsWith('```')).toBe(true);
  });

  it('keeps the language on fenced code blocks and supports backticks in code', () => {
    const out = convertMarkdown(
      '<pre><code class="language-typescript">const x = `tick`;</code></pre>',
    );
    expect(out.markdown).toContain('```typescript');
    expect(out.markdown).toContain('const x = `tick`;');
  });

  it('converts images with alt text and links', () => {
    const img = convertMarkdown('<img src="https://x.test/i.png" alt="A cat">');
    expect(img.markdown).toContain('![A cat](https://x.test/i.png)');

    const link = convertMarkdown('<a href="https://x.test/p">read more</a>');
    expect(link.markdown).toContain('[read more](https://x.test/p)');
  });

  it('preserves media card URLs as readable Markdown links', () => {
    const out = convertMarkdown(
      '<figure class="kg-card kg-video-card"><video controls>' +
      '<source src="https://x.test/video.mp4" type="video/mp4"></video>' +
      '<figcaption>Demo video</figcaption></figure>' +
      '<audio src="https://x.test/audio.mp3"></audio>' +
      '<iframe src="https://x.test/embed" title="Demo embed"></iframe>',
    );
    expect(out.markdown).toContain('[Video](https://x.test/video.mp4)');
    expect(out.markdown).toContain('[Audio](https://x.test/audio.mp3)');
    expect(out.markdown).toContain('[Demo embed](https://x.test/embed)');
    expect(out.markdown).toContain('Demo video');
  });

  it('converts GFM tables', () => {
    const out = convertMarkdown(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><td>Ada</td><td>37</td></tr></tbody></table>',
    );
    expect(out.markdown).toContain('| Name | Age |');
    expect(out.markdown.split('\n')[1]).toMatch(/^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/);
    expect(out.markdown).toMatch(/\|\s*Ada\s*\|\s*37\s*\|/);
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