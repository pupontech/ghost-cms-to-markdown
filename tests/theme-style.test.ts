import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/style.css', 'utf8');

describe('theme stylesheet', () => {
  it('uses dark as the default and exposes an explicit light palette', () => {
    expect(stylesheet).toContain('color-scheme: dark;');
    expect(stylesheet).toContain(":root[data-theme='light'] {\n  color-scheme: light;");
    expect(stylesheet).not.toContain('@media (prefers-color-scheme');
  });
});
