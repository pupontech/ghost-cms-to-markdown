import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function readSourceTree(): string {
  const sourceRoot = resolve(ROOT, 'src');
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(ts|js|mjs)$/.test(name)) files.push(path);
    }
  };
  visit(sourceRoot);
  return files.sort().map((path) => readFileSync(path, 'utf8')).join('\n');
}

describe('credential-free release boundary', () => {
  it('does not ship a credential or network connector', () => {
    const source = readSourceTree();

    expect(existsSync(resolve(ROOT, 'src/content-api.ts'))).toBe(false);
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(source).not.toMatch(/type\s*=\s*['"]password['"]|api-key|Content API/i);
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|chrome\.cookies/);
  });

  it('limits browser connections to the app origin', () => {
    const html = read('index.html');

    expect(html).toMatch(/connect-src\s+'self'/);
    expect(html).toMatch(/worker-src\s+'self' blob:/);
    expect(html).not.toMatch(/connect-src[^"']*https?:/i);
  });
});
