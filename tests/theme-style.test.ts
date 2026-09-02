import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/style.css', 'utf8');

describe('theme stylesheet', () => {
  it('lets explicit light mode override a dark OS preference', () => {
    expect(stylesheet).toContain(":root[data-theme='light'] {\n  color-scheme: light;\n}");
    expect(stylesheet).toContain(
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {",
    );
  });
});
