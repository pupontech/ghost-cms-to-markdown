import { describe, expect, it } from 'vitest';
import { normalizeContent } from '../src/normalizer';

describe('normalizeContent', () => {
  it('uses the entry HTML as the canonical input', () => {
    const out = normalizeContent({ html: '<p>Hello <em>world</em></p>' });
    if (!out.ok) throw new Error('expected success');
    expect(out.html).toBe('<p>Hello <em>world</em></p>');
    expect(out.sourceFormat).toBe('html');
  });

  it('trims surrounding whitespace from the HTML', () => {
    const out = normalizeContent({ html: '   \n<p>Hello</p>\n   ' });
    if (!out.ok) throw new Error('expected success');
    expect(out.html).toBe('<p>Hello</p>');
  });

  it('fails clearly when no HTML content is available', () => {
    const out = normalizeContent({ html: null });
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('no-content');
    expect(out.error.message).toMatch(/no html content/i);
  });

  it('fails clearly when HTML is only whitespace', () => {
    const out = normalizeContent({ html: '  \n  ' });
    if (out.ok) throw new Error('expected failure');
    expect(out.error.code).toBe('no-content');
  });
});