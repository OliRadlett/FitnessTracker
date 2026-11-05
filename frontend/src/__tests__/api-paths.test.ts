import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * A client API path must not end in `/`.
 *
 * A trailing slash is not cosmetic: the backend 308s `/api/v1/connections/` to
 * its absolute host, the browser follows cross-origin, and fetch strips the
 * Authorization header, so the request 401s. That is a page-level failure that
 * looks like a data bug. This guard catches the class, not one instance.
 */
const SRC = join(process.cwd(), 'src');
const SKIP_DIRS = new Set(['__tests__', 'node_modules']);
// The generated OpenAPI document lists paths with a trailing slash; it is not a
// client call site.
const SKIP_FILES = new Set(['src/lib/api/types/generated.ts']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(path);
  }
  return acc;
}

describe('client API paths', () => {
  it('never ends an /api/v1 path with a slash', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(join(SRC, '..'), file).split(sep).join('/');
      if (SKIP_FILES.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      const pattern = /['"`](\/api\/v1\/[^'"`\s]*\/)['"`]/g;
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${rel}:${line} ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
