import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../src/sanitize';

describe('sanitizeHtml', () => {
  it('keeps allowed structural tags intact', () => {
    const out = sanitizeHtml('<h1>Title</h1><p>Hello <strong>world</strong>.</p>');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<p>Hello <strong>world</strong>.</p>');
  });

  it('removes <script> and its content entirely', () => {
    const out = sanitizeHtml('<p>hello</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>hello</p>');
  });

  it('removes <style> and other dangerous elements with their content', () => {
    const out = sanitizeHtml('<style>*{color:red}</style><p>ok</p>');
    expect(out).not.toContain('color:red');
    expect(out).toContain('<p>ok</p>');
  });

  it('removes inline event handlers', () => {
    const out = sanitizeHtml('<p onclick="steal()" onerror="x()">safe</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('steal');
    expect(out).toContain('<p>safe</p>');
  });

  it('neutralizes javascript: URLs in links and images', () => {
    const link = sanitizeHtml('<a href="javascript:evil()">click</a>');
    expect(link).not.toContain('javascript:');

    const img = sanitizeHtml('<img src="javascript:evil()" alt="x">');
    expect(img).not.toContain('javascript:');
  });

  it('keeps https + relative hrefs', () => {
    const out = sanitizeHtml('<a href="https://x.test/p">a</a><a href="/rel">b</a>');
    expect(out).toContain('https://x.test/p');
    expect(out).toContain('/rel');
  });

  it('keeps contents of unknown harmless tags while removing the tag itself', () => {
    const out = sanitizeHtml('<foo>keep me</foo>');
    expect(out).toContain('keep me');
    expect(out).not.toContain('foo');
  });

  it('re-sanitizes children promoted out of unknown wrappers', () => {
    const out = sanitizeHtml('<foo><a href="javascript:evil()">click</a><script>alert(1)</script></foo>');
    expect(out).toContain('<a>click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert(1)');
  });

  it('strips disallowed attributes but keeps allowed ones like class', () => {
    const out = sanitizeHtml('<span class="x" data-user="y">t</span>');
    expect(out).not.toContain('data-user');
    expect(out).toContain('class="x"');
  });
});